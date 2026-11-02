const cloud = require('wx-server-sdk')
const axios = require('axios')
const Jimp = require('jimp')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 火山方舟 (豆包 Seedream) API — Key 从云函数环境变量 ARK_API_KEY 读取, 避免明文入库
// 配置入口: 微信开发者工具 → 云开发控制台 → 云函数 → addChristmasHat → 环境变量
const ARK_API_URL = 'https://ark.cn-beijing.volces.com/api/plan/v3/images/generations';
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_MODEL = 'doubao-seedream-5.0-flash';

// 每用户每日生成次数上限 (宽松兜底, 防接口被恶意刷量/反代滥用, 正常用户基本碰不到)
// 用量记录在云数据库 gen_usage 集合 (需在云开发控制台创建, 未创建时不限流仅告警)
const DAILY_LIMIT = 99;

exports.main = async (event, context) => {
  const { fileID, prompt } = event;

  try {
    if (!ARK_API_KEY) {
      return {
        success: false,
        msg: '未配置 ARK_API_KEY 环境变量，请在云开发控制台为云函数 addChristmasHat 配置后重试。'
      };
    }
    // ==========================================
    // 生成图片 (火山方舟为同步接口，直接返回结果)
    // ==========================================
    if (!fileID) {
      return {
          success: false,
          msg: `参数错误：未接收到 fileID。`
      };
    }

    // 每用户每日生成次数限制 (按北京时间自然日计)
    const openid = cloud.getWXContext().OPENID;
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const usageId = `gen_${openid}_${today}`;
    try {
      const db = cloud.database();
      let count = 0;
      try {
        const got = await db.collection('gen_usage').doc(usageId).get();
        count = got.data.count || 0;
      } catch (e) { /* 文档不存在, 视为今日首次 */ }

      if (count >= DAILY_LIMIT) {
        return {
          success: false,
          msg: `今日生成次数已达上限（每人每天 ${DAILY_LIMIT} 次），明天再来吧~`
        };
      }
      if (count === 0) {
        try {
          await db.collection('gen_usage').add({ data: { _id: usageId, count: 1 } });
        } catch (e) {
          // 并发时文档已被同时创建, 退回累加
          await db.collection('gen_usage').doc(usageId).update({ data: { count: db.command.inc(1) } });
        }
      } else {
        await db.collection('gen_usage').doc(usageId).update({ data: { count: db.command.inc(1) } });
      }
    } catch (e) {
      // 用量统计失败不阻塞生成 (例如 gen_usage 集合未创建)
      console.warn(`用量统计失败(不影响本次生成, 建议在云开发控制台创建 gen_usage 集合): ${e.message}`);
    }

    // 1. 从云存储下载图片
    const res = await cloud.downloadFile({
      fileID: fileID,
    });
    let buffer = res.fileContent;

    // 检查并调整图片尺寸 (Seedream 要求至少 384x384)
    let outputSize;
    try {
      console.log("Starting image processing...");
      const image = await Jimp.read(buffer);
      const minSize = 384;
      const maxSize = 2048;
      const { width, height } = image.bitmap;
      console.log(`Original image size: ${width}x${height}`);

      if (width < minSize || height < minSize) {
        console.log(`Image is too small (<${minSize}), resizing...`);
        
        // 计算缩放比例
        const scale = Math.max(minSize / width, minSize / height);
        // 向上取整，确保至少是 minSize
        const targetWidth = Math.ceil(width * scale);
        const targetHeight = Math.ceil(height * scale);

        // 使用 resize 明确指定尺寸
        image.resize(targetWidth, targetHeight);
        
        // 获取新的 buffer
        buffer = await image.getBufferAsync(Jimp.MIME_PNG);
        console.log(`Resized to ${targetWidth}x${targetHeight}`);
      } else if (width > maxSize || height > maxSize) {
        console.log(`Image is too large (>${maxSize}), resizing...`);
        
        // 保持比例缩小到最大边为 1024
        image.scaleToFit(maxSize, maxSize);
        
        // 获取新的 buffer
        buffer = await image.getBufferAsync(Jimp.MIME_PNG);
        console.log(`Resized to ${image.bitmap.width}x${image.bitmap.height}`);
      } else {
        console.log("Image size is sufficient.");
      }

      // 根据输入图片宽高比计算输出尺寸
      // 端点要求: 输出面积 >= 921600 像素 (960x960); 极端宽高比时保证最短边, 避免触发维度下限
      const MIN_AREA = 960 * 960;
      const MIN_DIM = 512;
      const MAX_DIM = 2048;
      let outW = image.bitmap.width;
      let outH = image.bitmap.height;
      if (outW > MAX_DIM || outH > MAX_DIM) {
        const scale = MAX_DIM / Math.max(outW, outH);
        outW = Math.round(outW * scale);
        outH = Math.round(outH * scale);
      }
      if (Math.min(outW, outH) < MIN_DIM) {
        const scale = MIN_DIM / Math.min(outW, outH);
        outW = Math.ceil(outW * scale);
        outH = Math.ceil(outH * scale);
      }
      if (outW * outH < MIN_AREA) {
        const scale = Math.sqrt(MIN_AREA / (outW * outH));
        outW = Math.ceil(outW * scale);
        outH = Math.ceil(outH * scale);
        // 兜底: 逐像素取整仍可能差几个像素
        while (outW * outH < MIN_AREA) outW += 1;
      }
      outputSize = `${outW}x${outH}`;
      console.log(`Output size: ${outputSize}`);
    } catch (err) {
      console.error("Image processing failed:", err);
      // 如果图片处理失败，抛出错误
      throw new Error("图片预处理失败: " + err.message);
    }

    // 转换为 Base64 Data URI
    const base64Image = `data:image/png;base64,${buffer.toString('base64')}`;

    // 构造提示词
    const finalPrompt = prompt ? `${prompt}, 戴着圣诞帽` : "戴着红色的圣诞帽, festive atmosphere, christmas hat";

    // 2. 调用火山方舟图片生成接口 (同步返回结果)
    const generateResponse = await axios.post(
      ARK_API_URL,
      {
        model: ARK_MODEL,
        prompt: finalPrompt,
        image: [base64Image],
        size: outputSize,          // 输出尺寸跟随输入图片宽高比
        response_format: 'url',    // 返回图片 URL
        watermark: false
      },
      {
        timeout: 55000, // 略小于云函数 60s 超时
        headers: {
          'Authorization': `Bearer ${ARK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (generateResponse.status !== 200) {
        throw new Error('API request failed');
    }

    const imageUrl = generateResponse.data.data[0].url;
    if (!imageUrl) {
        throw new Error('API 未返回图片 URL: ' + JSON.stringify(generateResponse.data));
    }

    // 生成成功后删除云存储中的输入图片, 避免存储无限累积 (失败不影响结果)
    try {
      await cloud.deleteFile({ fileList: [fileID] });
    } catch (e) {
      console.warn(`删除输入图片失败(不影响结果): ${e.message}`);
    }

    return {
        success: true,
        status: 'SUCCEEDED',
        imageUrl: imageUrl
    };

  } catch (error) {
    console.error(error);
    const arkError = error.response && error.response.data && error.response.data.error;
    const errCode = arkError ? arkError.code : '';

    // 将常见的 Ark 错误码翻译成用户能理解的提示
    let msg = '调用 AI 服务失败: ' + error.message;
    if (errCode.indexOf('SensitiveContentDetected') !== -1) {
      msg = '生成结果未通过内容审核（可能涉及版权或敏感内容）。请更换为自己的照片，或调整提示词后重试。';
    } else if (errCode === 'AuthenticationError' || errCode === 'InvalidApiKey') {
      msg = 'API Key 无效或已过期，请检查火山方舟密钥配置。';
    } else if (errCode === 'TooManyRequests' || (error.response && error.response.status === 429)) {
      msg = '请求太频繁，请稍后再试。';
    } else if (errCode === 'InvalidParameter') {
      msg = '请求参数错误: ' + (arkError.message || error.message);
    } else if (error.code === 'ECONNABORTED') {
      msg = '生成超时，请稍后重试。';
    }

    return {
      success: false,
      msg: msg,
      error: error.message,
      detail: error.response ? error.response.data : null
    };
  }
}
