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

    // 生成耗时与图片大小/网络相关, 固定预估不准, 改为显示实际已用时间
    let loadingTimer = null;

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

      // 3. 调用云函数生成 (火山方舟同步接口，一次调用直接返回结果)
      const startTime = Date.now();
      wx.showLoading({ title: 'AI生成中 0s' });
      loadingTimer = setInterval(() => {
        wx.showLoading({ title: `AI生成中 ${Math.floor((Date.now() - startTime) / 1000)}s` });
      }, 1000);

      const submitRes = await wx.cloud.callFunction({
        name: 'addChristmasHat',
        data: {
          fileID: fileID,
          prompt: this.data.prompt
        }
      });

      if (!submitRes.result.success) {
        // 详细错误只打到控制台，弹窗只展示用户可读的提示
        console.error('生成失败详情:', submitRes.result.detail || submitRes.result.error);
        throw new Error(submitRes.result.msg || '生成失败');
      }

      console.log('Generated image:', submitRes.result.imageUrl);

      // 4. 直接展示结果
      this.setData({
        resultImage: submitRes.result.imageUrl
      });
      wx.hideLoading();

    } catch (err) {
      wx.hideLoading();
      console.error('详细错误信息：', err);
      wx.showModal({
        title: '发生错误',
        content: err.errMsg || err.message || JSON.stringify(err),
        showCancel: false
      });
    } finally {
      if (loadingTimer) clearInterval(loadingTimer);
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
