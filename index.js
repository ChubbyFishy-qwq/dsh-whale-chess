/**
 * 鲸娘棋局 — Host 半侧。
 *
 * 棋局、评估、人格与记忆全部在浏览器端运行（Client bundle），
 * Host 只需要挂载本条目，让 Web 端加载对应的 client.js。
 * 这里不做任何会话注入：内心独白、persona 原文与记忆原始记录
 * 都只留在插件内部，不进入会话日志，也不返回给用户。
 */
export function apply() {
  /* no host-side resources */
}
