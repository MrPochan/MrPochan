// pm2 process list: the site/game server and the Telegram bot are separate processes.
// Paths are relative to this file, so the folder can live anywhere (for example /opt/roadflow).
const path = require('path');
module.exports = {
  apps: [
    {
      name: 'roadflow-server',
      cwd: path.join(__dirname, '../server'),     // reads server/.env
      script: 'src/index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
      kill_timeout: 5000,
      time: true,
    },
    {
      name: 'roadflow-bot',
      cwd: path.join(__dirname, '../bot'),        // reads bot/.env
      script: 'index.js',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '150M',
      restart_delay: 3000,
      time: true,
    },
  ],
};
