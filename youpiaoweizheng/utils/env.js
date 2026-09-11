// utils/env.js —— M2 环境开关
// ============================================
// 【你唯一需要改的文件】
// 开通云开发后（步骤见 README「M2 上线指南」）：
//   1. 把 USE_CLOUD 改成 true
//   2. 把 CLOUD_ENV 填成你的云环境 ID（形如 cloud1-2gabc123def456）
// 关着的时候：整个小程序跑在「演示模式」，用 mock 数据，所有界面照常可用。
// ============================================

const USE_CLOUD = true;          // 已开通云开发 ✅
const CLOUD_ENV = 'cloud1-d5gpnyzjw64a60ac7';  // 你的云环境 ID

module.exports = { USE_CLOUD, CLOUD_ENV };
