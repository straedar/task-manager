module.exports = {
  apps: [
    {
      name: "stockmap-api",
      cwd: __dirname,
      script: "npx",
      args: "tsx server/index.ts",
      env: {
        PORT: 3003,
        NODE_ENV: "production",
      },
    },
  ],
};
