import { ProjectList } from "./components/project-list";
import { connection } from "next/server";
import { getCanvasDocument, listProjects } from "@/features/projects/server/project-service";
import { Icon, type IconName } from "./components/app-icon";
import styles from "./ui-shell.module.css";

const navigation: Array<{ icon: IconName; label: string; active?: boolean }> = [
  { icon: "home", label: "首页", active: true },
  { icon: "folder", label: "项目" },
  { icon: "layers", label: "技能" },
];

export const instant = false;


export default async function Home() {
  await connection();
  const projects = await listProjects();
  const cards = await Promise.all(projects.map(async (project) => {
    const document = await getCanvasDocument(project.id).catch(() => null);
    const cover = document?.nodes.find((node) => node.type === "module" && node.data.moduleType === "image" && node.data.assetId);
    return {
      ...project,
      coverId: cover?.type === "module" ? cover.data.assetId : undefined,
      nodes: document?.nodes.length ?? 0,
      edges: document?.edges.length ?? 0,
    };
  }));
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
        <ProjectList cards={cards} />
      </section>
    </main>
  );
}
