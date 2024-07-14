/* eslint-disable @typescript-eslint/no-var-requires */
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');

function getBinaryName() {
  const platform = process.platform;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  if (platform === 'win32') {
    return `mkcert-${mkcertVersion}-windows-${arch}.exe`;
  }
  if (platform === 'darwin') {
    return `mkcert-${mkcertVersion}-darwin-${arch}`;
  }
  if (platform === 'linux') {
    return `mkcert-${mkcertVersion}-linux-${arch}`;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

// 定義下載URL
const mkcertVersion = 'v1.4.4';
const mkcertUrl = `https://github.com/FiloSottile/mkcert/releases/latest/download/${mkcertVersion}/${getBinaryName()}`;
const mkcertFileName = 'mkcert';

// 定義mkcert和證書保存的目錄
const mkcertDir = path.join(__dirname, '../mkcert');
const certDir = path.join(__dirname, '../certificates');
const mkcertPath = path.join(mkcertDir, mkcertFileName);

console.log('mkcertUrl', mkcertUrl);
console.log('certDir', certDir);
console.log('mkcertPath', mkcertPath);

const createSelfSignedCertificate = new Promise((resolve, reject) => {
  // 確保目錄存在
  if (!fs.existsSync(mkcertDir)) {
    fs.mkdirSync(mkcertDir);
  }
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir);
  }

  // 下載mkcert
  const downloadMkcert = (url, dest, cb) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close(cb);
        });
      })
      .on('error', (err) => {
        fs.unlink(dest);
        if (cb) cb(err.message);
      });
  };

  // 設定可執行權限 (僅適用於類Unix系統)
  const setExecutable = (filePath) => {
    if (process.platform !== 'win32') {
      execSync(`chmod +x ${filePath}`);
    }
  };

  // 生成證書的命令
  const mkcertCheckCommand = `${mkcertPath} -version`;
  const mkcertCommand = `${mkcertPath} -install && ${mkcertPath} -cert-file ${certDir}/localhost.pem -key-file ${certDir}/localhost-key.pem localhost 127.0.0.1 ::1`;

  // 下載並執行mkcert
  downloadMkcert(mkcertUrl, mkcertPath, (downloadError) => {
    if (downloadError) {
      console.error(`下載mkcert出錯: ${downloadError}`);
      return;
    }
    console.log('mkcert下載完成。');

    setExecutable(mkcertPath);

    exec(mkcertCheckCommand, (checkError, checkStdout, checkStderr) => {
      if (checkError) {
        console.error(`執行mkcert命令出錯: ${checkError}`);
        reject();
        return;
      }
      if (checkStderr) {
        console.error(`mkcert stderr: ${checkStderr}`);
        reject();
        return;
      }
      console.log(`check mkcert stdout: ${checkStdout}`);
    });

    // 執行mkcert命令來生成證書
    exec(mkcertCommand, (mkcertError, mkcertStdout, mkcertStderr) => {
      if (mkcertError) {
        console.error(`執行mkcert命令出錯: ${mkcertError}`);
        reject();
        return;
      }
      if (mkcertStderr) {
        console.error(`mkcert stderr: ${mkcertStderr}`);
        reject();
        return;
      }
      console.log(`mkcert stdout: ${mkcertStdout}`);
      console.log('證書已成功生成並保存在certificates目錄中。');
      resolve();
    });
  });
});

module.exports = {
  createSelfSignedCertificate,
};
