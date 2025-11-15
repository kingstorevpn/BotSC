module.exports = {
  apps: [
    {
      name: "sellsc",
      script: "app.js",
      cwd: "/root/BotSC",
      instances: 1,
      autorestart: true,
      watch: false
    }
  ],
};
