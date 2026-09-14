// utils/haptics.js —— 触觉反馈三档（7.4.0 · docs/MOTION.md §2.4）
// ============================================================
// 【为什么要收这一层】
//   在这之前，全站 47 处直接写 wx.vibrateShort({ type: 'light' | 'medium' | 'heavy' })。
//   同一个语义在不同页面是不同力度：「保存成功」有的地方是 medium、有的地方是 light，
//   谁写的谁说了算。力度该由**语义**决定，所以按语义只留三个口子：
//
//     tap()     轻：普通点击、切换、选中、开合
//     confirm() 中：保存成功、生成完成、解锁、印章落下
//     warn()    重：删除、失败、危险操作
//
// 【为什么每个都兜底】
//   演示模式没有 wx，个别低端机上也没这个接口。触觉是锦上添花，
//   绝不能因为它抛错，把「已保存到相册」这种主流程一起打断。
// ============================================================

function buzz(type) {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.vibrateShort === 'function') {
      wx.vibrateShort({ type });
    }
  } catch (e) { /* 触觉失败不影响任何主流程 */ }
}

module.exports = {
  tap: () => buzz('light'),
  confirm: () => buzz('medium'),
  warn: () => buzz('heavy')
};
