import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Icon } from "@/app/components/app-icon";
import { getCanvasModule } from "../module-registry";
import type { CanvasModuleNode, CanvasPortDefinition } from "../types";
import styles from "../canvas.module.css";

function PortHandles({ ports, kind }: { ports: CanvasPortDefinition[]; kind: "source" | "target" }) {
  return ports.map((port, index) => (
    <Handle
      className={`${styles.port} ${kind === "target" ? styles.inputPort : styles.outputPort}`}
      id={port.id}
      key={port.id}
      position={kind === "target" ? Position.Left : Position.Right}
      style={{ top: `${((index + 1) / (ports.length + 1)) * 100}%` }}
      title={`${port.label}${port.multiple ? "（支持多连接）" : ""}`}
      type={kind}
    />
  ));
}

export function ModuleNode({ data, selected }: NodeProps<CanvasModuleNode>) {
  const definition = getCanvasModule(data.moduleType);
  const { Body } = definition;

  return (
    <article
      className={`${styles.nodeCard} ${selected ? styles.nodeSelected : ""}`}
      style={{ width: definition.width }}
    >
      <PortHandles kind="target" ports={definition.inputs} />
      <header className={styles.nodeHeader}>
        <span className={`${styles.nodeHeaderIcon} ${definition.tone === "violet" ? styles.violetIcon : ""}`}>
          <Icon name={definition.icon} />
        </span>
        {definition.label}
        <button className="nodrag" aria-label={`${definition.label}更多操作`} type="button">
          <Icon name="more" />
        </button>
      </header>
      <Body data={data} />
      <PortHandles kind="source" ports={definition.outputs} />
    </article>
  );
}
