import Link from "next/link";
import { Icon, type IconName } from "./components/app-icon";
import styles from "./ui-shell.module.css";

const navigation: Array<{ icon: IconName; label: string; active?: boolean }> = [
  { icon: "home", label: "首页", active: true },
  { icon: "folder", label: "项目" },
  { icon: "layers", label: "技能" },
];

const projects = [
  { id: "emoji-workflow", title: "表情包工作流", meta: "今天 14:32 更新", tone: "violet", kind: "图片处理" },
  { id: "storyboard", title: "动画分镜整理", meta: "昨天 21:08 更新", tone: "blue", kind: "内容创作" },
  { id: "brand-assets", title: "品牌素材处理", meta: "10 月 30 日更新", tone: "mint", kind: "素材整理" },
  { id: "video-notes", title: "视频灵感与脚本", meta: "10 月 28 日更新", tone: "amber", kind: "视频" },
  { id: "product-research", title: "产品调研画布", meta: "10 月 24 日更新", tone: "rose", kind: "研究" },
  { id: "weekly-plan", title: "本周工作规划", meta: "10 月 21 日更新", tone: "indigo", kind: "规划" },
];

export default function Home() {
  return (
    <main className={styles.homeShell}>
      <aside className={styles.homeSidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true"><span /><span /><span /></span>
          <span>MOWO Canvas</span>
        </div>

        <nav className={styles.homeNavigation} aria-label="主导航">
          {navigation.map((item) => (
            <button className={item.active ? styles.navItemActive : styles.navItem} key={item.label} type="button">
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <button className={`${styles.navItem} ${styles.settingsNav}`} type="button">
          <Icon name="settings" />
          <span>设置</span>
        </button>
      </aside>

      <section className={styles.homeContent}>
        <header className={styles.homeHeader}>
          <div>
            <p className={styles.eyebrow}>工作空间</p>
            <h1>我的画布</h1>
            <p>继续最近的工作流，或从一张空白画布开始。</p>
          </div>
          <Link className={styles.primaryButton} href="/canvas/new">
            <Icon name="plus" />
            新建画布
          </Link>
        </header>

        <div className={styles.projectControls}>
          <label className={styles.searchField}>
            <Icon name="search" />
            <input aria-label="搜索画布" placeholder="搜索画布" type="search" />
          </label>
          <button className={styles.sortButton} type="button">
            最近更新
            <Icon name="chevron-down" />
          </button>
        </div>

        <div className={styles.projectGrid}>
          <Link className={styles.newCanvasCard} href="/canvas/new">
            <span className={styles.newCanvasIcon}><Icon name="plus" /></span>
            <strong>新建画布</strong>
            <span>创建一个新的空白工作流</span>
          </Link>

          {projects.map((project) => (
            <Link className={styles.projectCard} href={`/canvas/${project.id}`} key={project.id}>
              <div className={`${styles.projectPreview} ${styles[`preview_${project.tone}`]}`}>
                <div className={styles.previewTopRow}><span /><span /><span /></div>
                <div className={styles.previewWorkspace}>
                  <span className={styles.previewNodeA} />
                  <span className={styles.previewLine} />
                  <span className={styles.previewNodeB} />
                  <span className={styles.previewNodeC} />
                </div>
              </div>
              <div className={styles.projectInfo}>
                <div><h2>{project.title}</h2><p>{project.meta}</p></div>
                <span className={styles.moreButton} aria-hidden="true"><Icon name="more" /></span>
              </div>
              <span className={styles.projectTag}>{project.kind}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
