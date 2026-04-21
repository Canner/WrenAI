# 分析规则（导入准备）

> 建议后续导入到 knowledge instructions。
> 
> 约定：
> - `scope=global`：全局规则
> - `scope=question_match`：按 questions 关键词匹配的规则

---

## R01 汇总口径
- scope: `global`
- priority: `high`
- applies_to: 综合日报表 / 首存及续存率 / 投充比与杀率 / 游戏类型流水分布
- keywords: 无（全局规则）
- instruction: 汇总行的人数类指标按去重后的分子汇总；比率类指标必须先汇总分子分母，再计算比率，不能平均每日比率。
- notes: 建议作为全局 instruction。

## R02 首存定义
- scope: `question_match`
- priority: `high`
- applies_to: 综合日报表 / ROI回收表 / 首存及续存率 / 首存金额分布与占比
- keywords: `首存` `首充` `首次存款`
- instruction: 当问题涉及首存、首充、首次存款时，首存定义为成功存款且 `times = 1`。

## R03 新客首存
- scope: `question_match`
- priority: `high`
- applies_to: 综合日报表
- keywords: `新客首存`
- instruction: 当问题涉及新客首存时，定义为注册日 = 首存日的首存用户。

## R04 开发人数
- scope: `question_match`
- priority: `high`
- applies_to: 综合日报表
- keywords: `开发人数`
- instruction: 当问题涉及开发人数时，定义为非当日注册但在统计日完成首存的用户数。

## R05 TOPN 口径
- scope: `question_match`
- priority: `high`
- applies_to: ROI回收表 / 首存及续存率 / 投充比与杀率 / 游戏类型流水分布
- keywords: `TOP3` `TOP5` `非TOP3` `非TOP5`
- instruction: 当问题涉及 TOP3/TOP5/非TOP3/非TOP5 时，必须按所选统计区间内的累计有效投注排序，不按单日排序。
- notes: TOPN 应先在整段区间内排名，再回写到指标统计。

## R06 VIP 分层口径
- scope: `question_match`
- priority: `high`
- applies_to: ROI回收表 / 投充比与杀率
- keywords: `VIP0` `VIP1` `VIP2` `VIP3` `VIP分层`
- instruction: 当问题涉及 VIP0/VIP1/VIP2... 分层时，统一按所选统计区间内达到的最高 VIP 等级归类，不按查询时点当前 VIP 归类。
- notes: 若当前没有 SQL 化的玩家日 VIP 模型，需要先补数据模型。

## R07 投充比公式
- scope: `question_match`
- priority: `high`
- applies_to: 综合日报表 / 投充比与杀率
- keywords: `投充比`
- instruction: 投充比 = 有效投注 / 存款金额；若存款金额为 0，则返回空值或按产品约定处理，不能随意补 0。

## R08 杀率公式
- scope: `question_match`
- priority: `high`
- applies_to: 投充比与杀率 / 游戏类型流水分布
- keywords: `杀率`
- instruction: 杀率 = 输赢 / 有效投注；若有效投注为 0，则返回空值或按产品约定处理。

## R09 ROI 收入口径
- scope: `question_match`
- priority: `high`
- applies_to: ROI回收表
- keywords: `ROI` `渠道收入` `累计收入`
- instruction: 渠道收入 = 输赢金额 -（任务彩金 + 洗码金额 + 营销金额 + 优惠加扣款）；ROI = 渠道累计收入 / 投放金额。
- notes: 如果缺少投放金额源，则只能输出累计收入，不能输出 ROI。

## R10 续存口径
- scope: `question_match`
- priority: `high`
- applies_to: 首存及续存率
- keywords: `次存` `三存` `四存` `五存` `六存` `续存率`
- instruction: 二存到六存均以统计期首存 cohort 为基准；二存率到六存率分母统一为首存人数。

## R11 游戏类型分布口径
- scope: `question_match`
- priority: `high`
- applies_to: 游戏类型流水分布
- keywords: `游戏类型` `投注占比` `均注金额`
- instruction: 游戏类型分布中的均注金额 = 有效投注 / 下注次数；投注占比 = 该类型有效投注 / 合计有效投注。

## R12 首存金额分桶
- scope: `question_match`
- priority: `high`
- applies_to: 首存金额分布与占比
- keywords: `首存金额分布` `10元` `20元` `2000元以上` `其他金额`
- instruction: 首存金额分布按固定档位 `10/20/30/50/100/200/300/400/500/1000/2000/>2000/其他` 输出；其他 = 2000 以内但不在固定档位。

## R13 缺失数据源处理
- scope: `question_match`
- priority: `high`
- applies_to: 综合日报表 / ROI回收表
- keywords: `投放金额` `PV` `UV` `下载点击UV` `UV下载率` `UV注册率` `首存成本`
- instruction: 当问题涉及投放金额、访问PV、访问UV、下载点击UV，而当前知识库中无对应 SQL 模型或表时，必须明确说明当前缺少数据源，无法计算，不能用其他字段替代。
- notes: 当前已确认缺失：投放金额、PV/UV/下载点击UV。

## R14 ES 数据使用限制
- scope: `question_match`
- priority: `high`
- applies_to: ROI回收表 / 投充比与杀率 / 游戏类型流水分布
- keywords: `ES` `玩家日汇总` `VIP日快照`
- instruction: 当问题需要使用 legacy ES 指标（如玩家日 VIP、玩家日游戏或线路汇总）时，优先使用对应 SQL 映射表或视图；如果未提供 SQL 映射，不要输出 ES DSL，应说明当前系统仅支持 SQL 模板。
- notes: 当前系统 SQL pair 创建时会做 SQL 校验，不能直接导入 DSL。
