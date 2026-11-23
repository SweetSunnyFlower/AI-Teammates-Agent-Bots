import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDot,
  Code2,
  Database,
  GitPullRequest,
  Layers3,
  Mail,
  Search,
  Server,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Dotty — 把工作交给一支 AI 团队",
  description:
    "Dotty 在一个自托管的迷你办公室里组织 AI Bot。总控规划、部门执行，发送、支付、发布、删除和合并必须经过你的批准。",
};

const navLinks = [
  { href: "#how-it-works", label: "工作方式" },
  { href: "#capabilities", label: "产品能力" },
  { href: "#safety", label: "安全边界" },
  { href: "#self-hosted", label: "自托管" },
];

const steps = [
  {
    number: "01",
    title: "交办",
    description: "把目标告诉总控 Bot。它可以先问清条件，再把工作拆开。",
    icon: Bot,
  },
  {
    number: "02",
    title: "拆解",
    description: "总控按部门拆分任务，分配给合适的 Lead Bot 和 Worker Bot。",
    icon: Layers3,
  },
  {
    number: "03",
    title: "执行",
    description: "各楼层并行工作，办公室实时显示每个 Bot 的真实状态。",
    icon: Workflow,
  },
  {
    number: "04",
    title: "审阅",
    description: "外向动作停在“待我处理”。你批准、修改或拒绝后，工作才继续。",
    icon: ShieldCheck,
  },
];

const actionBoundaries = ["发送", "支付", "发布", "删除", "合并"];

const stack = [
  { label: "Next.js", icon: Code2 },
  { label: "PostgreSQL", icon: Database },
  { label: "Better Auth", icon: ShieldCheck },
  { label: "pg-boss", icon: Layers3 },
  { label: "DeepSeek", icon: Bot },
  { label: "SearXNG", icon: Search },
  { label: "Docker / Podman", icon: Server },
  { label: "Caddy", icon: CheckCircle2 },
];

export default function LandingPage() {
  return (
    <div className={styles.page} id="top">
      <div className={styles.topGlow} aria-hidden="true" />

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} href="#top" aria-label="Dotty 首页">
            <span className={styles.brandMark} aria-hidden="true">
              <Building2 />
            </span>
            <span className={styles.brandName}>Dotty</span>
            <span className={styles.brandStatus}>
              <span className={styles.statusDot} />
              AI 团队工作台
            </span>
          </Link>

          <nav className={styles.navLinks} aria-label="主导航">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <Link className={styles.navCta} href="/auth/login">
            开始使用
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              自托管 AI 团队 · 现场手册 01
            </p>

            <h1 id="hero-title">把工作交给一支 AI 团队。<span>你只负责最后点头。</span></h1>

            <p className={styles.heroLead}>
              总控 Bot 负责规划和分派，各楼层负责执行。发送、支付、发布、删除和合并，都会停在“待我处理”，只有你批准后才会发生。
            </p>

            <div className={styles.heroActions}>
              <Link className={styles.primaryButton} href="/auth/login">
                开始组建团队
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link className={styles.secondaryButton} href="/workspace">
                看看办公室
              </Link>
            </div>

            <div className={styles.trustLine} role="group" aria-label="产品运行方式">
              <span>
                <CheckCircle2 aria-hidden="true" />
                邮箱密码登录
              </span>
              <span>
                <Database aria-hidden="true" />
                数据保存在你的 PostgreSQL
              </span>
              <span>
                <Bot aria-hidden="true" />
                DeepSeek 提供模型能力
              </span>
            </div>
          </div>

          <div className={styles.heroVisual}>
            <div className={styles.lawnShape} aria-hidden="true" />
            <div className={styles.noteCard} aria-hidden="true">
              <span>THE OFFICE IS LIVE</span>
              <strong>楼层、任务与状态，在同一张桌面里。</strong>
            </div>

            <div className={styles.productFrame}>
              <div className={styles.browserBar}>
                <span className={styles.browserDots} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>dotty / 办公室</span>
                <span className={styles.browserLive}>
                  <span className={styles.statusDot} />
                  工作中
                </span>
              </div>
              <div className={styles.screenshotWrap}>
                <Image
                  src="/dotty-office.png"
                  alt="Dotty 办公室界面，显示楼层、Bot 团队、任务状态和实时动态"
                  width={1917}
                  height={1078}
                  sizes="(max-width: 900px) 100vw, 58vw"
                  loading="eager"
                />
              </div>
            </div>

            <div className={styles.approvalTag}>
              <span className={styles.approvalIcon} aria-hidden="true">
                <ShieldCheck />
              </span>
              <span>
                <strong>审批门已开启</strong>
                <small>外向动作会先停下来等你</small>
              </span>
            </div>
          </div>
        </section>

        <section className={styles.capabilityBand} aria-label="核心能力">
          <span>总控分派</span>
          <span>部门协作</span>
          <span>审批闸门</span>
          <span>例行任务</span>
          <span>自托管</span>
          <span>DeepSeek</span>
        </section>

        <section className={styles.section} id="how-it-works" aria-labelledby="how-title">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>
                <span className={styles.eyebrowDot} />
                工作方式
              </p>
              <h2 id="how-title">一句话进来，一组结果出去。</h2>
            </div>
            <p>
              不是把所有工作塞进同一个聊天窗口。每个任务都有负责人、状态和下一步，你可以随时看见它在哪里。
            </p>
          </div>

          <ol className={styles.steps}>
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <li key={step.number}>
                  <div className={styles.stepTopline}>
                    <span className={styles.stepNumber}>{step.number}</span>
                    <span className={styles.stepIcon} aria-hidden="true">
                      <Icon />
                    </span>
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </li>
              );
            })}
          </ol>
        </section>

        <section
          className={`${styles.section} ${styles.capabilitiesSection}`}
          id="capabilities"
          aria-labelledby="capabilities-title"
        >
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>
                <span className={styles.eyebrowDot} />
                产品能力
              </p>
              <h2 id="capabilities-title">不是一个聊天框，而是一间会工作的办公室。</h2>
            </div>
            <p>
              组织、状态、计划和工具都围绕同一件工作展开。Bot 不是一个头像，而是一位有岗位、有权限的同事。
            </p>
          </div>

          <div className={styles.featureGrid}>
            <article className={`${styles.featureCard} ${styles.featureDark} ${styles.featureWide}`}>
              <div className={styles.featureHeader}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <Bot />
                </span>
                <span className={styles.featureKicker}>总控与分派</span>
              </div>
              <h3>先计划，再让整层楼动起来。</h3>
              <p>总控 Bot 拆解目标，各层 Lead Bot 接住自己的部分，再把具体工作交给 Worker Bot。</p>
              <div className={styles.orgMap} aria-hidden="true">
                <span className={styles.orgHead}>
                  <Bot />
                  总控 Bot
                </span>
                <i className={styles.orgStem} />
                <div className={styles.orgBranches}>
                  <span>助理</span>
                  <span>研究</span>
                  <span>工程</span>
                </div>
              </div>
            </article>

            <article className={`${styles.featureCard} ${styles.featureMint}`}>
              <div className={styles.featureHeader}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <CircleDot />
                </span>
                <span className={styles.featureKicker}>看得见的进度</span>
              </div>
              <h3>状态不是一个模糊的“正在思考”。</h3>
              <p>工作中、等待中、休息中和出错会同步显示在 Bot、楼层、任务看板与动态里。</p>
              <div className={styles.statusStack}>
                <span data-tone="working">
                  <i />
                  工作中 · 正在检索资料
                </span>
                <span data-tone="waiting">
                  <i />
                  等待中 · 需要你的批准
                </span>
                <span data-tone="resting">
                  <i />
                  休息中 · 等待下一项任务
                </span>
              </div>
            </article>

            <article className={`${styles.featureCard} ${styles.featureHoney}`}>
              <div className={styles.featureHeader}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <CalendarClock />
                </span>
                <span className={styles.featureKicker}>例行任务与回顾</span>
              </div>
              <h3>你睡觉时，工作也有节奏。</h3>
              <p>按计划启动研究、整理和检查。早上把完成、失败和待审批的事项汇总给你。</p>
              <div className={styles.routineCard} aria-hidden="true">
                <span>工作日</span>
                <strong>晨间回顾</strong>
                <span>汇总夜间工作 → 待我处理</span>
              </div>
            </article>

            <article className={`${styles.featureCard} ${styles.featurePaper} ${styles.featureWide}`}>
              <div className={styles.featureHeader}>
                <span className={styles.featureIcon} aria-hidden="true">
                  <Workflow />
                </span>
                <span className={styles.featureKicker}>研究、邮件与工程</span>
              </div>
              <h3>工具按 Bot 授权，动作按边界执行。</h3>
              <p>研究 Bot 可以搜索网页，助理 Bot 可以准备邮件，工程 Bot 可以在隔离沙箱里运行代码。</p>
              <div className={styles.toolGrid}>
                <span>
                  <Search aria-hidden="true" />
                  SearXNG 搜索
                </span>
                <span>
                  <Mail aria-hidden="true" />
                  SMTP 邮件
                </span>
                <span>
                  <GitPullRequest aria-hidden="true" />
                  GitHub 审阅
                </span>
                <span>
                  <Code2 aria-hidden="true" />
                  沙箱代码执行
                </span>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.safetySection} id="safety" aria-labelledby="safety-title">
          <div className={styles.safetyCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              安全边界
            </p>
            <h2 id="safety-title">自动化可以很快，但最后一步必须是你。</h2>
            <p>
              “请它做”和“让它直接做”是两件事。只要动作会影响外部世界，Dotty 都会把准确内容和操作项交给你确认。
            </p>
            <div className={styles.boundaryList} role="group" aria-label="需要审批的动作">
              {actionBoundaries.map((action) => (
                <span key={action}>
                  <Check aria-hidden="true" />
                  {action}
                </span>
              ))}
            </div>
            <ul className={styles.safetyPoints}>
              <li>机器人不能绕过审批直接调用外向工具。</li>
              <li>批准前可以修改内容，拒绝后不会执行。</li>
              <li>审批记录与任务、运行记录保存在同一个数据库。</li>
            </ul>
          </div>

          <div className={styles.approvalStage}>
            <span className={styles.sampleLabel}>示例审批</span>
            <div className={styles.approvalCard}>
              <div className={styles.approvalCardHeader}>
                <span className={styles.approvalCardIcon} aria-hidden="true">
                  <Mail />
                </span>
                <span>
                  <small>助理 Bot 准备执行</small>
                  <strong>发送邮件</strong>
                </span>
              </div>
              <dl>
                <div>
                  <dt>收件人</dt>
                  <dd>项目联系人</dd>
                </div>
                <div>
                  <dt>主题</dt>
                  <dd>本周项目进展</dd>
                </div>
                <div>
                  <dt>正文</dt>
                  <dd>草稿已整理完成。批准后才会通过 SMTP 发送。</dd>
                </div>
              </dl>
              <div className={styles.approvalActions} role="group" aria-label="审批操作示例">
                <span data-action="approve">
                  <Check />
                  批准
                </span>
                <span data-action="edit">编辑</span>
                <span data-action="reject">拒绝</span>
              </div>
              <p>
                <ShieldCheck aria-hidden="true" />
                未批准时，邮件工具不会执行。
              </p>
            </div>
            <span className={styles.decisionNote}>批准 · 修改 · 拒绝</span>
          </div>
        </section>

        <section className={styles.hostSection} id="self-hosted" aria-labelledby="host-title">
          <div className={styles.hostCard}>
            <div className={styles.hostCopy}>
              <p className={styles.eyebrow}>
                <span className={styles.eyebrowDot} />
                自托管
              </p>
              <h2 id="host-title">你的团队，运行在你的服务器上。</h2>
              <p>
                Dotty 不依赖 Supabase、Trigger.dev 或 Upstash Box。业务数据、认证、任务队列和搜索都可以留在自己的基础设施里。
              </p>
              <div className={styles.hostFacts}>
                <span>
                  <Database aria-hidden="true" />
                  单一 PostgreSQL
                </span>
                <span>
                  <Server aria-hidden="true" />
                  Caddy + systemd
                </span>
                <span>
                  <ShieldCheck aria-hidden="true" />
                  Docker / rootless Podman
                </span>
              </div>
            </div>

            <div className={styles.stackPanel} role="group" aria-label="自托管技术栈">
              <div className={styles.stackPanelHeader}>
                <span>DOTTY RUNTIME</span>
                <span className={styles.stackLive}>
                  <i />
                  SELF-HOSTED
                </span>
              </div>
              <div className={styles.stackGrid}>
                {stack.map((item) => {
                  const Icon = item.icon;
                  return (
                    <span key={item.label}>
                      <Icon aria-hidden="true" />
                      {item.label}
                    </span>
                  );
                })}
              </div>
              <p>
                <Database aria-hidden="true" />
                数据、队列与业务状态共享一个数据库边界。
              </p>
            </div>
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="final-title">
          <div className={styles.finalStamp} aria-hidden="true">
            START SMALL
          </div>
          <div>
            <p className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              从这里开始
            </p>
            <h2 id="final-title">先给它们一件小事。</h2>
            <p>创建一个工作空间，把第一个任务交给总控 Bot。你会看到团队如何拆开它，也会决定最后哪一步可以发生。</p>
          </div>
          <div className={styles.finalActions}>
            <Link className={styles.primaryButton} href="/auth/login">
              开始使用
              <ArrowRight aria-hidden="true" />
            </Link>
            <a className={styles.textLink} href="#how-it-works">
              再看一遍工作方式
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <span className={styles.footerMark} aria-hidden="true">
            <Building2 />
          </span>
          <span>
            <strong>Dotty</strong>
            <small>用一间办公室组织 AI 工作。</small>
          </span>
        </div>
        <nav aria-label="页脚导航">
          <a href="#how-it-works">工作方式</a>
          <a href="#capabilities">产品能力</a>
          <a href="#safety">安全边界</a>
          <Link href="/auth/login">开始使用</Link>
        </nav>
        <p>© 2026 Dotty · 自托管 · 简体中文</p>
      </footer>
    </div>
  );
}
