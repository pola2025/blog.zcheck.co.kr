/**
 * 네이버 블로그 이미지 업로드 스크립트
 * Page.fileChooserOpened의 backendNodeId + DOM.setFileInputFiles 방식
 *
 * 사용법: node scripts/upload-image.js <이미지경로> [triggerX] [triggerY]
 */
const CDP = require('chrome-remote-interface');
const path = require('path');

async function uploadImage(filePath, triggerX = 36, triggerY = 74) {
  let client;
  try {
    const absolutePath = path.resolve(filePath).replace(/\\/g, '/');
    console.log(`Uploading: ${absolutePath}`);

    // Chrome CDP 연결
    const targets = await CDP.List({ port: 9222 });
    const blogTarget = targets.find(t =>
      t.type === 'page' && t.url.includes('blog.naver.com')
    );
    if (!blogTarget) throw new Error('네이버 블로그 탭을 찾을 수 없습니다');

    client = await CDP({ target: blogTarget, port: 9222 });

    await client.send('Page.enable', {});
    await client.send('DOM.enable', {});

    // File chooser 인터셉트 활성화
    await client.send('Page.setInterceptFileChooserDialog', { enabled: true });

    // fileChooserOpened → backendNodeId로 직접 파일 설정
    const fileChooserPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('File chooser did not open within 15s'));
      }, 15000);

      client.once('Page.fileChooserOpened', async (params) => {
        clearTimeout(timeout);
        console.log(`File chooser opened (backendNodeId: ${params.backendNodeId})`);
        try {
          await client.send('DOM.setFileInputFiles', {
            backendNodeId: params.backendNodeId,
            files: [absolutePath],
          });
          console.log('File set successfully');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    // 사진 버튼 클릭
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: triggerX, y: triggerY, button: 'left', clickCount: 1,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: triggerX, y: triggerY, button: 'left', clickCount: 1,
    });

    await fileChooserPromise;
    await client.send('Page.setInterceptFileChooserDialog', { enabled: false });

    // 이미지 처리 대기
    console.log('Waiting for image processing...');
    await new Promise(r => setTimeout(r, 3000));
    console.log('Done!');
  } catch (e) {
    console.error('Error:', e.message);
    if (client) {
      try { await client.send('Page.setInterceptFileChooserDialog', { enabled: false }); } catch {}
    }
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node scripts/upload-image.js <image-path> [triggerX] [triggerY]');
  process.exit(1);
}

uploadImage(args[0], args[1] ? parseInt(args[1]) : 36, args[2] ? parseInt(args[2]) : 74);
