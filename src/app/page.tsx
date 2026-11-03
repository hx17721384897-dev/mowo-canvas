import Link from "next/link";
import { connection } from "next/server";
import { listProjects } from "@/features/projects/server/project-service";
import { Icon, type IconName } from "./components/app-icon";
import { NewCanvasButton } from "./components/new-canvas-button";
import styles from "./ui-shell.module.css";

const navigation: Array<{ icon: IconName; label: string; active?: boolean }> = [
  { icon: "home", label: "首页", active: true },
  { icon: "folder", label: "项目" },
  { icon: "layers", label: "技能" },
];

const tones = ["violet", "blue", "mint", "amber", "rose", "indigo"] as const;

export const instant = false;

function formatUpdatedAt(value: string) {
  return `${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(value))} 更新`;
}

export default async function Home() {
  await connection();
  const projects = await listProjects();
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
          <NewCanvasButton className={styles.primaryButton} />
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
          <NewCanvasButton card className={styles.newCanvasCard} />

          {projects.map((project, index) => (
            <Link className={styles.projectCard} href={`/canvas/${project.id}`} key={project.id}>
              <div className={`${styles.projectPreview} ${styles[`preview_${tones[index % tones.length]}`]}`}>
                <div className={styles.previewTopRow}><span /><span /><span /></div>
                <div className={styles.previewWorkspace}>
                  <span className={styles.previewNodeA} />
                  <span className={styles.previewLine} />
                  <span className={styles.previewNodeB} />
                  <span className={styles.previewNodeC} />
                </div>
              </div>
              <div className={styles.projectInfo}>
                <div><h2>{project.name}</h2><p>{formatUpdatedAt(project.updatedAt)}</p></div>
                <span className={styles.moreButton} aria-hidden="true"><Icon name="more" /></span>
              </div>
              <span className={styles.projectTag}>{project.assetCount ? `${project.assetCount} 项资产` : "空白画布"}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
