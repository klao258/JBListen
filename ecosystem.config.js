// ecosystem.config.js
module.exports = {
    apps: [
      {
        name: "JBListen",
        script: "start.js",
        interpreter: "node",
        cwd: __dirname,
        watch: false,
        autorestart: true,
        env: {
          NODE_ENV: "production"
        }
      }
    ]
};