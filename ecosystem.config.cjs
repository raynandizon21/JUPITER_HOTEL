// PM2 config for Jupiter Hotel PMS.
//   npm run build && pm2 start ecosystem.config.cjs && pm2 save
// The frontend is the built `dist/` folder; the backend serves it together with /api.
module.exports = {
  apps: [
    {
      name: 'JupiterHotel-Backend',
      cwd: __dirname,
      script: 'server/index.js',
      node_args: '--env-file=.env',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        API_PORT: 4020, // 4000 is taken by GDCAGE on this server
      },
    },
  ],
};
