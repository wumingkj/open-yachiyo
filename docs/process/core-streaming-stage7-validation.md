# Core Streaming 阶段 7 验证说明（压测/混沌）

## 目标
- 在不引入灰度流程的前提下，补齐核心稳定性验证：
  - 去重抗压
  - 流式 + 早发 + 并发共存回归

## 新增测试
1. `test/runtime/toolCallDispatcher.test.js`
- 新增 `burst duplicate requests` 场景：
  - 同一 `trace_id + call_id` 短时间内连续 20 次请求
  - 断言执行次数始终为 1
  - 断言请求响应覆盖完整（20 条结果）
  - 断言绝大多数结果带 `dedup_hit=true`

## 回归矩阵（本阶段执行）
- `test/runtime/openaiReasoner.test.js`
- `test/runtime/toolLoopRunner.test.js`
- `test/runtime/runtimeRpcWorker.test.js`
- `test/runtime/toolCallDispatcher.test.js`
- `test/runtime/toolCallAccumulator.test.js`
- `test/runtime/tooling.test.js`

## 已验证
- 运行命令：
  - `node --test test/runtime/openaiReasoner.test.js test/runtime/toolLoopRunner.test.js test/runtime/runtimeRpcWorker.test.js test/runtime/toolCallDispatcher.test.js test/runtime/toolCallAccumulator.test.js test/runtime/tooling.test.js`
- 结果：全部通过。

## 当前结论
- 单会话内流式文本、增量参数、早发、受控并发、去重在现有测试矩阵下可协同工作。
- 默认配置下仍保持串行与兼容行为；开启开关后可逐步获得时延收益。
