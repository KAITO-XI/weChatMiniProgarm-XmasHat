Page({
  data: {
    selectedImage: '',
    prompt: '',
    resultImage: '',
    loading: false
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'], // 使用压缩图，加快上传和处理速度
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        
        // 获取图片信息以预估时间
        wx.getImageInfo({
          src: tempFilePath,
          success: (info) => {
            this.setData({
              selectedImage: tempFilePath,
              resultImage: '', // Clear previous result
              imgWidth: info.width,
              imgHeight: info.height
            });
          },
          fail: () => {
            this.setData({
              selectedImage: tempFilePath,
              resultImage: ''
            });
          }
        });
      }
    });
  },

  onInputChange(e) {
    this.setData({
      prompt: e.detail.value
    });
  },

  async generateChristmasHat() {
    if (!this.data.selectedImage) return;

    this.setData({ loading: true });

    try {
      wx.showLoading({ title: '上传图片中...' });
      
      // 1. 上传图片到云存储
      const cloudPath = `input_images/${Date.now()}-${Math.floor(Math.random() * 1000)}.png`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: this.data.selectedImage,
      });
      
      const fileID = uploadRes.fileID;

      // 2. 获取临时访问链接 (供 AI API 读取)
      // const urlRes = await wx.cloud.getTempFileURL({
      //   fileList: [fileID]
      // });
      // const tempFileURL = urlRes.fileList[0].tempFileURL;
      
      // console.log('Image uploaded to:', tempFileURL);

      // 估算时间
      let estimateTime = 15; // 基础时间
      if (this.data.imgWidth && this.data.imgHeight) {
        const pixels = this.data.imgWidth * this.data.imgHeight;
        // 简单估算：每 50万像素增加 5 秒
        estimateTime += Math.ceil(pixels / 500000) * 5;
      }
      if (estimateTime > 60) estimateTime = 60; // 上限显示 60s

      wx.showLoading({ title: `AI生成中(约${estimateTime}s)` });

      // 3. 提交任务
      const submitRes = await wx.cloud.callFunction({
        name: 'addChristmasHat',
        data: {
          fileID: fileID,
          prompt: this.data.prompt
        }
      });

      if (!submitRes.result.success) {
        const detailMsg = submitRes.result.detail ? JSON.stringify(submitRes.result.detail) : '';
        throw new Error((submitRes.result.msg || '提交任务失败') + '\n详细信息: ' + detailMsg);
      }

      const taskId = submitRes.result.taskId;
      console.log('Task submitted, ID:', taskId);

      // 4. 轮询任务状态
      let attempts = 0;
      const maxAttempts = 60; // 最多轮询 60 次
      const interval = 3000;  // 每次间隔 3 秒
      
      while (attempts < maxAttempts) {
        attempts++;
        
        // 等待
        await new Promise(resolve => setTimeout(resolve, interval));
        
        const checkRes = await wx.cloud.callFunction({
          name: 'addChristmasHat',
          data: { taskId: taskId }
        });

        const status = checkRes.result.status;
        console.log(`Polling attempt ${attempts} (${attempts * interval / 1000}s): ${status}`);

        if (status === 'SUCCEEDED') {
          this.setData({
            resultImage: checkRes.result.imageUrl
          });
          wx.hideLoading();
          return; // 成功结束
        } else if (status === 'FAILED') {
          throw new Error(checkRes.result.msg || '生成失败');
        }
        // 如果是 PENDING 或 RUNNING，继续循环
      }

      throw new Error('生成超时，请稍后重试');

    } catch (err) {
      wx.hideLoading();
      console.error('详细错误信息：', err);
      wx.showModal({
        title: '发生错误',
        content: err.errMsg || err.message || JSON.stringify(err),
        showCancel: false
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  previewResult() {
    if (this.data.resultImage) {
      wx.previewImage({
        urls: [this.data.resultImage]
      });
    }
  },

  saveImage() {
    if (!this.data.resultImage) return;
    
    wx.showLoading({ title: '保存中...' });

    // 如果是云存储文件ID，先获取临时链接，如果是http链接直接下载
    // 这里 resultImage 应该是 http 链接 (来自 API)
    wx.downloadFile({
      url: this.data.resultImage,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.hideLoading();
            wx.showToast({ title: '保存成功' });
          },
          fail: (err) => {
            wx.hideLoading();
            console.error(err);
            // 用户可能拒绝了授权
            if (err.errMsg.includes('auth deny')) {
                wx.showModal({
                    title: '提示',
                    content: '需要您授权保存图片到相册',
                    success: modalRes => {
                        if (modalRes.confirm) {
                            wx.openSetting();
                        }
                    }
                });
            } else {
                wx.showToast({ title: '保存失败', icon: 'none' });
            }
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载图片失败', icon: 'none' });
      }
    });
  },

  reset() {
    this.setData({
      selectedImage: '',
      prompt: '',
      resultImage: ''
    });
  }
});
