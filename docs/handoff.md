# 数据库本地网页工作台交接

更新日期：2026-10-16（Asia/Shanghai）。本文为项目唯一交接与维护文档，整合运行方式、代码结构、验证记录和待办。

## 当前状态与工作约定

- 项目及 npm 包名为 `db-assistant`；本文中的文件路径均相对于项目根目录。
- 已支持 MySQL、PostgreSQL、SQLite；Oracle 延期，只有部分共享类型和方言基础，没有注册驱动或开放连接入口。
- 面向本机单用户，中文网页通过本地 Fastify 服务操作数据库；不提供账号系统、公网部署、SSH 隧道或完整备份恢复。
- Git 由用户自行操作；后续代理不要执行 Git 操作，不启用子代理。当前目录没有 Git 元数据，不能推断分支、提交或远端状态。
- 验收只使用自行创建的临时目录、合成数据和已授权的独立测试环境；不要读取其他项目凭据或操作正式数据。当前正式服务状态未检查，旧目录、端口和 PID 不作为操作依据。

## 安装、启动与检查

需要 Node.js 24 或更新版本，在项目根目录执行：

```sh
npm ci
npm run build
npm start
```

默认访问 `http://127.0.0.1:3210`，Ctrl+C 停止。可用 `npm start -- --port 3211` 或 `MWA_PORT` 更换端口；命令行参数优先。macOS 可运行根目录的 `start.comman`。开发使用 `npm run dev`，前端固定在 5173，代理到后端 3210。

运行数据默认位于 `.local-data/`，可通过 `MWA_DATA_DIR` 改为其他本地目录。其中 `assistant.sqlite` 保存连接配置、操作日志和任务；网络数据库密码只在内存中保存，重启后须重新连接。运行数据、密码和密钥不得写入版本库。

```sh
npm test                         # 单元测试；与 test:unit 相同
npm run typecheck
npm run build
npm run test:integration:sqlite   # 临时 SQLite 文件，不依赖外部实例
```

完整集成命令为 `npm run test:integration`。MySQL 需要安全注入 `MWA_TEST_PASSWORD`，可选 `MWA_TEST_HOST/PORT/USER` 和跨实例用的 `MWA_TEST_SECOND_PORT`；测试创建/清理随机库，触发器权限测试还会创建/清理临时账户，需要相应管理权限。PostgreSQL 仅在明确授权独立测试环境后运行 `MWA_PG_TEST_ENABLED=1 npm run test:integration:postgresql`，可配 `MWA_PG_TEST_HOST/PORT/DATABASE/USER/PASSWORD`，默认本机 5432、postgres 数据库和当前系统用户名；测试创建/清理随机 schema，需要 CREATE 权限。不要对生产数据库运行。缺少条件导致的跳过不能算通过。

## 功能与关键边界

| 能力 | MySQL | PostgreSQL | SQLite |
| --- | --- | --- | --- |
| 连接、表树、结构查看、SQL/补全、筛选分页 | 支持 | 支持 | 支持 |
| 表格新增、修改、删除 | 带可靠主键的普通 InnoDB 表 | 根据权限、类型和主键判定 | 根据只读状态、类型和主键判定 |
| CSV/XLSX 导入；CSV/XLSX/SQL INSERT 表导出 | 支持 | 支持 | 支持 |
| 查询结果快照 CSV/XLSX 导出 | 支持 | 支持 | 支持 |
| 可视化建表、字段及二级索引管理 | 支持 | 结构页只读，DDL 经 SQL 执行 | 结构页只读，DDL 经 SQL 执行 |
| 跨库/跨实例迁移与主键同步 | 支持 | 未实现 | 未实现 |

所有能力以服务端元数据判定为准，视图等对象不能编辑。SQL 每次使用独立会话，只执行单条语句，不保留临时表或跨次手工事务。查询默认显示 100 行，可设 1–1,000；SQL 上限 256 KiB，结果上限 10 MiB，执行限时 60 秒。展示截断不代表 RETURNING 写入没有全部执行，影响行数须以完整消费后的结果为准。

**数据保真：** 大整数、高精度小数、JSON 和微秒日期时间保持原始文本；区分 NULL、空串和二进制。PostgreSQL timestamptz 按 UTC 读取，未知原生类型保守只读，视图/分区/继承/外部表只读；SQL 导出可恢复 ALWAYS identity，但不校准 sequence，恢复后须核对。SQLite 保留实际存储类别，64 位整数以文本传输；亲和性可能转换输入，NUMERIC/REAL 不保证任意精度。生成列只读，JSON/二进制不在表格中编辑。

**连接：** PostgreSQL 连接已有数据库，默认 schema 为 public；目标兼容 PostgreSQL 14+，不自动建库。SQLite 只连接已存在文件的绝对路径，不接受内存库、URI 或工作台自己的配置库；仅使用 main，不支持 ATTACH，文件身份变化后须重连。SQLite 每个执行单元由独立子进程中的 Worker 承载，超时/取消会终止执行单元。PostgreSQL/SQLite 每连接最多 4 个执行单元和 16 个等待请求；锁等待分别为 10 秒和 5 秒，SQLite 不改用户文件的 journal_mode。

**导入导出与恢复：** 上传限 100 MiB，预览前 20 行，每批最多 500 行并受字节预算限制。导入只写已有可导入表，失败批次回滚并停止，已提交批次保留；取消在批次边界生效。提交或本地确认不明时保留「结果待核对」，不可自动重试。CSV/XLSX 的 NULL、空串和反斜杠使用工具可逆格式，外部文件可关闭；二进制十六进制展示不能直接导回，SQL INSERT 支持二进制。Excel 已舍入数值无法恢复。XLSX 最多 16,384 列、1,000,000 条数据行，单元格编码后最多 32,767 个 UTF-16 单元。正常完成文件保留 24 小时，未完成文件不可下载，待核对任务摘要不因普通过期清理而删除。查询快照导出不重执行 SQL，按位置保留重复/空列名；SQL INSERT 表导出需要已有兼容表，不是全库备份。

**MySQL 结构修改：** 服务端白名单生成单条 DDL，先预览再确认，预览 5 分钟有效且一次性消费；结构/连接代次变化要求重做。专用连接独占执行，DDL 隐式提交，发送后取消或断线不能保证服务端未执行。破坏性操作需完整名称确认，未确认执行结果保留待核对；高级对象保持设计限制，不能假定能无损改写任意建表定义。

**MySQL 同步迁移：** 每次最多 100 张普通 InnoDB 表，目标库须已存在，源目标不能是同一物理库。迁移只创建缺失表并复制非生成列，不覆盖或清空既有表；同步要求同结构和完整主键，保留目标多余行，其他唯一键冲突使当前批次回滚。源使用一致性只读事务和元数据锁，目标逐批提交，无全局事务、自动重试或重启续传。拒绝外键、触发器、视图、分区/高级选项和空间/向量字段；源账户须直接具有所选表/库的 TRIGGER 权限以检查不可见触发器，仅角色授权暂不支持。输入完整目标库名后开始；取消/失败保留已创建表和已提交批次。

## 代码结构与维护入口

技术栈：TypeScript、React、Vite、Fastify；数据库使用 mysql2、pg/pg-cursor、Node 内置 node:sqlite；CSV 使用 csv-parse/csv-stringify，XLSX 写出使用 ExcelJS，读取使用 unzipper/saxes 加临时 SQLite 控制共享字符串内存。具体依赖版本以 package-lock.json 为准。

| 位置 | 用途 |
| --- | --- |
| `src/server/index.ts`、`app.ts` | 端口/数据目录、服务启动、依赖装配、路由注册和关闭清理 |
| `src/server/http/access.ts` | 本机 Host/Origin 检查和 API 会话 token 校验 |
| `src/server/database/` | 中立会话/游标契约、驱动注册、方言及 PostgreSQL/SQLite 实现；Oracle 仅方言基础 |
| `src/server/mysql/` | 原有 MySQL 驱动与类型处理；中立包装在 `database/mysql.ts` 和 `mysql-factory.ts` |
| `src/server/features/` | connections、data、sql、structure、transfers、migrations、logs 的路由及业务逻辑 |
| `src/server/local/` | 本机配置 SQLite 和操作日志持久化；迁移任务表由 migrations/store.ts 管理 |
| `src/shared/` | 跨前后端契约、值类别、筛选、结构/迁移类型与限制 |
| `src/web/App.tsx`、`api/client.ts` | 工作区、切表草稿保护、会话初始化及统一 API 调用 |
| `src/web/features/` | 对应功能的中文界面；连接类型入口在 connections/database-options.ts |
| `tests/unit/`、`tests/integration/` | Vitest/Testing Library 单元及数据库集成回归 |
| `tests/{mysql,postgresql,sqlite}/`、`tests/helpers/` | 合成数据、独立环境与共享流程断言；另有 bootstrap/web 辅助验证 |
| `dist/`、`node_modules/`、`logs/` | 构建产物、安装依赖和本机工具日志，不是业务源码 |

请求示例：`DataGrid` → `api/client.ts` → `/api/data/browse` → Zod 校验 → 按连接类型分派。MySQL 保留 `data/query.ts` 既有路径；PostgreSQL/SQLite 走 `data/database-query.ts` → DatabaseRegistry → 对应适配器/方言 → 会话/游标 → 统一元数据、精确值及实际 SQL 返回界面。新增功能应遵循这一分工，不能假定全部数据库已经走同一代码路径。

现有约定：React 组件使用 PascalCase 文件名，业务模块多为小写连字符，测试为 `*.test.ts/tsx`；服务端使用 Zod 校验，业务错误使用 AppFault，经统一处理器返回 `{error}`。能力限制须同时在服务端执行。写入依赖结构指纹、连接代次、事务和操作日志；不要把未知结果记为成功或重试写入。项目没有配置 lint、format 或 coverage 脚本，交接时不要声称已运行这些检查。

## 验证结果与未测项

2026-10-16 在当前目录重新运行，环境 Node.js 26.2.0 / npm 12.0.0：

| 检查 | 实际结果 |
| --- | --- |
| `npm test` | 44 文件、175 项通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；前端主包 680.69 kB / gzip 216.48 kB，仍提示超过 500 kB |
| `npm run test:integration:sqlite` | 5 文件、40 项通过 |

本次文档整理没有重跑 MySQL/PostgreSQL 集成、完整集成或浏览器验收，没有启动/停止正式服务。

保留的历史证据摘要：MySQL 曾在本机 9.7.0 和独立云端 8.0.46 验证；PostgreSQL 18.4 曾通过 7 项真实集成，覆盖精确类型、CRUD、导入导出/SQL 恢复、1005 行 RETURNING、取消、批次回滚及提交确认丢失。SQLite 曾完成浏览器新增、CSV 导入、XLSX 原生下载重读、SQL 查询/复制；PostgreSQL 曾完成表树、结构/浏览、新增、查询快照 CSV 原生下载重读。历史描述的截图在当前目录缺失，不能作为当前可查看证据；测试环境清理和旧服务状态只属于当时记录。

Node 24 最低版本、PostgreSQL 14、真实 TLS 证书/错误主机名、受限账户矩阵、物理断网/断电、磁盘满和大文件压力尚未完整实测。PostgreSQL 浏览器 CSV/XLSX 上传、筛选/补全快捷键、修改删除及剪贴板内容也未完整验收，自动测试不能替代这些结论。历史依赖检查记录了 ExcelJS → uuid 的 2 个 moderate 告警；本次没有重跑审计，不能称当前已消除或仍为同一数量。

## 剩余待办

1. **补齐环境验证：** 在已授权独立环境重跑 MySQL/PostgreSQL 集成和所需浏览器流程，补 Node 24、PostgreSQL 14、TLS 与受限账户矩阵；记录版本、通过/跳过数量和清理结果。
2. **补齐交付证据：** 当前缺少历史截图。后续浏览器验收仅使用合成数据，并把实际结果更新到本文；有必要时再保留新截图，不凭旧文件名宣称证据存在。
3. **改善构建体积：** 评估 SQL 编辑器等模块按需加载，验证首屏、SQL 页和导入导出行为；目前只是构建提示，不是构建失败。
4. **复核依赖与极限场景：** 在可联网时重跑生产依赖审计；升级文件处理依赖前复验 CSV/XLSX 往返和资源清理，补大文件/磁盘异常验证，不直接强制降级依赖。
5. **延期范围：** Oracle 驱动仍待用户明确恢复；PostgreSQL/SQLite 可视化结构管理、同步迁移、SQL 文件导入和完整备份恢复均未实现，不作为当前已承诺功能。

## 文档整理记录

按用户要求仅保留本交接文档，其余 README、设计、计划、进度及独立验收文档已合并后删除。原始文档已在项目外的临时目录备份；临时备份可能被系统清理，需要长期保留时由用户另存。项目名称已统一为 `db-assistant`，同步更新 npm 元数据、依赖锁文件和 PostgreSQL 应用标识；业务功能未改变。
