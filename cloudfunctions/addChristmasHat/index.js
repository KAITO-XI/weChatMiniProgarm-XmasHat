const cloud = require('wx-server-sdk')
const axios = require('axios')
const Jimp = require('jimp')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 阿里云 API Key
const ALIYUN_API_KEY = 'sk-3589df3d7e7f417e98a83da4bf2ef9fd'; 

exports.main = async (event, context) => {
  const { fileID, prompt, taskId } = event;

  try {
    // ==========================================
    // 模式 1: 查询任务状态 (如果传入了 taskId)
    // ==========================================
    if (taskId) {
      const checkResponse = await axios.get(
        `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
        {
          headers: { 'Authorization': `Bearer ${ALIYUN_API_KEY}` }
        }
      );
      
      const taskStatus = checkResponse.data.output.task_status;
      
      if (taskStatus === 'SUCCEEDED') {
        return {
          success: true,
          status: 'SUCCEEDED',
          imageUrl: checkResponse.data.output.results[0].url
        };
      } else if (taskStatus === 'FAILED') {
        return {
          success: false,
          status: 'FAILED',
          msg: '生成失败: ' + JSON.stringify(checkResponse.data.output)
        };
      } else {
        // PENDING or RUNNING
        return {
          success: true,
          status: taskStatus
        };
      }
    }

    // ==========================================
    // 模式 2: 提交新任务 (如果传入了 fileID)
    // ==========================================
    if (!fileID) {
      return { 
          success: false, 
          msg: `参数错误：未接收到 fileID 或 taskId。` 
      };
    }

    // 1. 从云存储下载图片
    const res = await cloud.downloadFile({
      fileID: fileID,
    });
    let buffer = res.fileContent;

    // 检查并调整图片尺寸 (Wanx2.1 要求至少 256x256)
    try {
      const image = await Jimp.read(buffer);
      const minSize = 256;
      const { width, height } = image.bitmap;

      if (width < minSize || height < minSize) {
        console.log(`Image size ${width}x${height} is too small, resizing to fit min ${minSize}...`);
        // 计算缩放比例，确保最小边至少为 256
        const scale = Math.max(minSize / width, minSize / height);
        image.scale(scale);
        
        // 获取新的 buffer
        buffer = await image.getBufferAsync(Jimp.MIME_PNG);
        console.log(`Resized to ${image.bitmap.width}x${image.bitmap.height}`);
      }
    } catch (err) {
      console.error("Image processing failed:", err);
    }

    // 转换为 Base64 Data URI
    const base64Image = `data:image/png;base64,${buffer.toString('base64')}`;

    // 构造提示词
    // description_edit 模式下，提示词应该是对目标图片的完整描述，建议使用英文
    const finalPrompt = prompt 
        ? `${prompt}, wearing a red Christmas hat, festive atmosphere` 
        : "A person wearing a red Christmas hat, festive atmosphere";

    // 2. 发起生成任务
    const submitResponse = await axios.post(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis',
      {
        model: "wanx2.1-imageedit", 
        input: {
          function: "description_edit",
          prompt: finalPrompt,
          base_image_url: base64Image
        },
        parameters: {
          n: 1,
          ref_strength: 0.5 // 尝试调整参考图强度，避免生成结果与原图一致
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${ALIYUN_API_KEY}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable'
        }
      }
    );

    if (submitResponse.status !== 200) {
        throw new Error('API submission failed');
    }

    // 仅返回 taskId，由前端进行轮询
    return {
        success: true,
        taskId: submitResponse.data.output.task_id,
        status: 'SUBMITTED'
    };

  } catch (error) {
    console.error(error);
    return {
      success: false,
      msg: '调用 AI 服务失败',
      error: error.message,
      detail: error.response ? error.response.data : null
    };
  }
}
