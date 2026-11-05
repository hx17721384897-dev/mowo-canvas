import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AssistantRuntimeProvider, ComposerPrimitive, ThreadPrimitive, useLocalRuntime } from "@assistant-ui/react";

const adapter = {
  async *run() {
    yield { content: [{ type: "text", text: "兼容验证" }] };
  },
};

function Probe() {
  const runtime = useLocalRuntime(adapter);
  return createElement(AssistantRuntimeProvider, { runtime },
    createElement(ThreadPrimitive.Root, null,
      createElement(ComposerPrimitive.Root, null,
        createElement(ComposerPrimitive.Input, { placeholder: "MOWO compatibility probe" }))));
}

const html = renderToString(createElement(Probe));
assert.ok(html.includes("MOWO compatibility probe"));
assert.ok(html.includes("textarea"));
console.log("assistant-ui 运行时与输入组件在当前 React SSR 中成功渲染。");
