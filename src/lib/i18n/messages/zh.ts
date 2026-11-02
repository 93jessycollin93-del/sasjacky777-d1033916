/**
 * Simplified Chinese.
 *
 * One plural category — `other` — so a count needs exactly one form and
 * supplying `one` as well is harmless but never selected. The real risks here
 * are different: text runs about 40% shorter than English, which leaves buttons
 * looking empty rather than clipped, and the script needs a font stack that
 * actually carries Han glyphs or every character renders as a box.
 */
import type { en } from "./en";

export const zhHans: Partial<Record<keyof typeof en, string>> = {
  "workstation.title": "工作站",
  "workstation.subtitle":
    "{live, plural, =0 {尚无站点响应} other {{total} 个可检测站点中有 # 个已响应}}",
  "workstation.next": "下一步",
  "workstation.check": "检测",
  "workstation.online": "在线 · 可同步",
  "workstation.offline": "离线 · 功能完整",

  "stage.ignition": "启动",
  "stage.core": "核心",
  "stage.workstation": "工作站",
  "stage.field": "外场",
  "stage.ready": "就绪",
  "stage.blocked": "受阻",
  "stage.pending": "待检",

  "station.required": "必需",
  "station.open": "打开",
  "station.offlineFull": "可离线运行",
  "station.offlineSync": "可离线运行，有网时同步",
  "station.offlineNone": "需要联网",
  "state.live": "在线",
  "state.declared": "已声明",
  "state.absent": "无响应",
  "state.unknown": "检测中",

  "partitions.title": "离线分区",
  "partitions.budget": "已分配 {granted}，各分区下限共需 {needed}，剩余 {spare}。",
  "partitions.noQuota": "无法获取存储配额：{reason}",
  "partitions.reading": "正在读取设备存储配额…",
  "partitions.backupNote": "备份与其复制的记录存放在一起，因此恢复无需联网。",
  "partitions.durable": "已防清除",
  "partitions.evictable": "可能被清除",
  "partitions.sync": "备份并同步",
  "partitions.belowFloor": "低于下限——该分区在此设备上无法完成其职责。",
  "partitions.records": "{count, plural, =0 {暂无记录} other {# 条记录}}",
  "partitions.backups": "{count, plural, =0 {暂无备份} other {# 份备份}}，上限 {depth}",

  "squads.title": "小队",
  "squads.intro":
    "由路由器编成的作战单元，设有主责与支援。每个单元依据一次共享的环境观测制定一次计划，在一组简短条件仍然成立期间保持该路径。",
  "squads.operational": "可执行",
  "squads.grounded": "无路径",
  "squads.lookAgain": "重新观测",
  "squads.efficiency":
    "{total} 个单元中有 {units} 个可执行 · {looks, plural, other {# 次观测}}回答了 {questions, plural, other {# 个问题}}（{held}% 沿用）",
  "squads.replanned":
    "{count, plural, =0 {本轮无需重算} other {本轮有 # 个路由器重算}}",
  "squads.held": "沿用",
  "squads.rePlanned": "已重算",
  "squads.noPath": "无路径",
  "squads.watching": "监视",

  "routers.title": "微型 AI 上下文路由器",
  "routers.intro": "每个路由器将一个小模型与其擅长的分区配对，并通过可达的最近引擎作答。",
  "routers.ask": "向路由器提问——它会根据问题自行判断归属",
  "routers.askButton": "提问",
  "routers.nothingReady": "本地没有可用的应答引擎。请启动 Ollama，或为获准联网的路由器接入网络。",
  "routers.context": "上下文",

  "crew.title": "班底",
  "crew.intro": "每个领域配一名专才，而非用一件工具应付全部。此机当前可启动 {total} 项中的 {ready} 项。",
  "crew.ready": "就绪",
  "crew.blocked": "受阻",
  "crew.needs": "需要 {capabilities}",

  "locale.title": "语言",
  "locale.change": "切换语言",

  "common.retry": "重试",
  "common.close": "关闭",
  "common.copied": "已复制",
  "common.lastChecked": "上次检测 {when}",
};
