import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function checkEditorBrowser(base, projectId, assetId, root, compositionOutputId) {
  const profile = join(root, 'browser');
  const browser = spawn(process.env.MOWO_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
  const pending = new Map(); let nextId = 0, socket;
  const onMessage = event => {
    const message = JSON.parse(event.data);
    if (process.argv.includes('--cutting-step-five') && message.method === 'Runtime.exceptionThrown')
      console.error('Browser exception:', message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.accept(message.result);
  };
  const connect = async url => {
    const nextSocket = new WebSocket(url);
    await once(nextSocket, 'open');
    nextSocket.addEventListener('message', onMessage);
    const previous = socket; socket = nextSocket;
    previous?.close();
  };
  const delay = ms => new Promise(accept => setTimeout(accept, ms));
  const cdp = (method, params = {}) => new Promise((accept, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser timeout: ${method}`)); }, 30000);
    pending.set(id, { accept, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, userGesture = false) => {
    const data = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
    assert.ok(!data.exceptionDetails, JSON.stringify(data.exceptionDetails));
    return data.result.value;
  };
  const until = async (expression, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await delay(200);
    }
    throw new Error(`Browser state did not arrive: ${expression}`);
  };
  const step = direction => evaluate(`document.querySelector('canvas[role="slider"]').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(direction === 1 ? 'ArrowRight' : 'ArrowLeft')},bubbles:true}))`);
  const click = label => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith(${JSON.stringify(label)}))?.click()`);
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
      catch { await delay(100); }
    }
    assert.ok(port, 'Chrome debugging port unavailable');
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    await connect(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    if (process.argv.includes('--cutting-step-five')) await cdp('Runtime.enable');
    await cdp('Page.navigate', { url: `${base}/video-editor/${projectId}/${assetId}` });
    await until(`document.body?.textContent.includes('已索引 301 帧')`);
    if (['--cutting-step-one', '--cutting-step-two', '--cutting-step-three', '--cutting-step-four', '--cutting-playback-modes']
      .some(flag => process.argv.includes(flag))) {
      await until(`document.body.textContent.includes('工程已保存')`);
      await evaluate(`Array.from(document.querySelectorAll('[aria-label="视频编辑区"] button')).find(b=>b.textContent==='适应全片')?.click()`);
    }
    if (process.argv.includes('--cutting-playback-modes')) {
      await until(`document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length===2 && document.querySelector('[aria-label="视频编辑区"] [aria-pressed]')?.textContent.includes('源帧 0–2')`);
      await evaluate(`document.querySelector('video').muted=true;document.querySelector('video').currentTime=2.6`);
      await until(`document.querySelector('video').currentTime>2.5`);
      await evaluate(`window.__cuttingHeads=[];window.__contiguousSeeks=0;document.querySelector('video').addEventListener('seeking',()=>window.__contiguousSeeks++);window.__cuttingTimer=setInterval(()=>window.__cuttingHeads.push(parseFloat(document.querySelector('[class*="cuttingPlayhead"]').style.left)),10)`);
      await evaluate(`document.querySelector('[aria-label="播放视频"]').click()`, true);
      await until(`document.querySelector('video').currentTime>3.4`, 12000);
      await evaluate(`document.querySelector('video').pause();clearInterval(window.__cuttingTimer)`);
      const seamHeads = await evaluate(`window.__cuttingHeads`);
      const seamBacktrack = Math.max(0, ...seamHeads.slice(1).map((head, index) => seamHeads[index] - head));
      assert.ok(seamBacktrack < 12, `contiguous split must not move the composition playhead backwards: ${JSON.stringify({seamBacktrack,seamHeads})}`);
      assert.equal(await evaluate(`window.__contiguousSeeks`), 0, 'contiguous clips must not seek at the split');
      await evaluate(`document.querySelector('video').currentTime=4.8`);
      await until(`document.querySelector('video').currentTime>4.5`);
      await evaluate(`window.__sourceFrames=[];window.__sourceTimer=setInterval(()=>window.__sourceFrames.push(Number(document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow'))),10)`);
      await evaluate(`document.querySelector('[aria-label="播放视频"]').click()`, true);
      await until(`document.querySelector('video').paused && document.querySelector('[class*="transport"]')?.textContent.includes('成片 00:00:05')`, 12000);
      await evaluate(`clearInterval(window.__sourceTimer)`);
      const endState = await evaluate(`({source:document.querySelector('video').currentTime,cutting:document.querySelector('[class*="transport"]')?.textContent})`);
      assert.ok(endState.source > 4.5 && endState.source < 5, `composition must stop without rewinding the source playhead: ${JSON.stringify(endState)}`);
      const sourceFrames = await evaluate(`window.__sourceFrames`);
      assert.ok(sourceFrames.every((frame, index) => !index || frame >= sourceFrames[index - 1]),
        `source frame playhead must not step backwards at composition end: ${JSON.stringify(sourceFrames)}`);
      await evaluate(`document.querySelector('[aria-label="播放视频"]').click()`, true);
      await until(`!document.querySelector('video').paused && document.querySelector('video').currentTime<2.5`);
      await evaluate(`document.querySelector('video').pause()`);
      const sourceCanvas = await evaluate(`(() => {const r=document.querySelector('canvas[role="slider"]').getBoundingClientRect();return {x:r.left+r.width*.15,y:r.top+r.height/2};})()`);
      await cdp('Input.dispatchMouseEvent', { type:'mousePressed', ...sourceCanvas, button:'left', clickCount:1 });
      await cdp('Input.dispatchMouseEvent', { type:'mouseReleased', ...sourceCanvas, button:'left', clickCount:1 });
      await until(`document.querySelector('video').currentTime>10 && document.querySelector('[class*="transport"]')?.textContent.includes('原片')`);
      const beforeSourcePlay = await evaluate(`({source:document.querySelector('video').currentTime,cutting:document.querySelector('[class*="cuttingPlayhead"]')?.style.left})`);
      await evaluate(`document.querySelector('[aria-label="播放视频"]').click()`, true);
      await until(`document.querySelector('video').currentTime>${beforeSourcePlay.source + .2}`, 12000);
      const sourcePlay = await evaluate(`({source:document.querySelector('video').currentTime,cutting:document.querySelector('[class*="cuttingPlayhead"]')?.style.left,transport:document.querySelector('[class*="transport"]')?.textContent})`);
      assert.ok(sourcePlay.source>beforeSourcePlay.source && sourcePlay.transport.includes('原片') && sourcePlay.cutting===beforeSourcePlay.cutting,
        `source playback must follow the upper seek and leave the composition playhead still: ${JSON.stringify({beforeSourcePlay,sourcePlay})}`);
      await evaluate(`document.querySelector('video').pause();document.querySelector('video').currentTime=document.querySelector('video').duration`);
      await until(`document.querySelector('video').ended || document.querySelector('video').currentTime>=300.9`);
      await evaluate(`document.querySelector('[aria-label="播放视频"]').click()`, true);
      await until(`!document.querySelector('video').paused && document.querySelector('video').currentTime<3 && document.querySelector('[class*="transport"]')?.textContent.includes('原片')`);
      assert.equal(await evaluate(`document.querySelector('[class*="cuttingPlayhead"]')?.style.left`), beforeSourcePlay.cutting,
        'source replay must leave the composition playhead still');
      console.log('Cutting playback modes passed: composition end/replay and independent source playback after upper seek.');
      return;
    }
    if (process.argv.includes('--cutting-step-five')) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await until(`document.body.textContent.includes('工程已保存') && document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length===2`);
      assert.ok(await evaluate(`document.querySelector('[aria-label="视频编辑区"] a')?.textContent.includes('下载 MP4')`));
      await click('保存到素材库并放入画布');
      let placed = false, navigated = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const response = await fetch(`${base}/api/projects/${projectId}/canvas`);
        const state = await response.json();
        placed = state.document?.nodes?.filter(node => node.data?.assetId === compositionOutputId).length === 1;
        const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        navigated = tabs.some(tab => tab.type === 'page' && tab.url.includes(`/canvas/${projectId}`));
        if (placed && navigated) break;
        await delay(250);
      }
      assert.ok(placed && navigated, 'saved output should be placed once and editor should open the canvas');
      console.log('Cutting step five browser passed: saved output reuses existing asset and appears as a video node on the canvas.');
      return;
    }
    if (process.argv.includes('--cutting-step-four')) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await until(`document.body.textContent.includes('工程已保存') && document.querySelector('[aria-label="视频编辑区"] [aria-pressed]')?.textContent.includes('源帧 0–300')`);
      assert.ok(await evaluate(`document.querySelector('[aria-label="撤销"]').disabled && document.querySelector('[aria-label="重做"]').disabled`));
      await evaluate(`(() => {document.querySelector('video').currentTime=150;document.querySelector('[aria-label="视频编辑区"] [aria-pressed]').click();})()`);
      await until(`Number(document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow'))===150`);
      await until(`!Array.from(document.querySelectorAll('[aria-label="视频编辑区"] button')).find(b=>b.textContent==='在播放头拆分').disabled`);
      await click('在播放头拆分');
      await until(`document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length===2`);
      await until(`document.body.textContent.includes('工程已保存')`);
      await click('校正分镜');
      await evaluate(`document.querySelector('video').currentTime=50`);
      await until(`Number(document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow'))===50`);
      await click('在当前帧拆分');
      await until(`document.querySelectorAll('[aria-label="镜头列表"] button').length===4`);
      await until(`!document.querySelector('[aria-label="撤销"]').disabled`);
      await click('撤销');
      await until(`document.querySelectorAll('[aria-label="镜头列表"] button').length===3`);
      assert.equal(await evaluate(`document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length`), 2);
      await until(`!document.querySelector('[aria-label="撤销"]').disabled`);
      await click('撤销');
      await until(`document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length===1`);
      assert.ok(await evaluate(`document.querySelector('[aria-label="撤销"]').disabled && !document.querySelector('[aria-label="重做"]').disabled`));
      await click('重做');
      await until(`document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length===2`);
      await until(`!document.querySelector('[aria-label="重做"]').disabled`);
      await click('重做');
      await until(`document.querySelectorAll('[aria-label="镜头列表"] button').length===4`);
      await until(`document.body.textContent.includes('工程已保存')`);
      await cdp('Page.reload', { ignoreCache: true });
      await delay(700);
      await until(`document.body?.textContent.includes('已索引 301 帧') && document.body.textContent.includes('工程已保存') && document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length===2`);
      assert.ok(await evaluate(`document.querySelector('[aria-label="撤销"]').disabled && document.querySelector('[aria-label="重做"]').disabled`));
      console.log('Cutting step four passed: shared undo/redo order across shot and clip edits, autosave and reload restore.');
      return;
    }
    if (process.argv.includes('--cutting-step-three')) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await until(`document.querySelector('[aria-label="视频编辑区"] [aria-pressed]')?.textContent.includes('源帧 0–300')`);
      await until(`Array.from(document.querySelectorAll('[aria-label="视频编辑区"] img')).some(image=>image.naturalWidth>0)`);
      await evaluate(`document.querySelector('[aria-label="放大剪辑时间轴"]').click()`);
      await until(`document.querySelector('[class*="cuttingViewport"]').scrollWidth>document.querySelector('[class*="cuttingViewport"]').clientWidth+100`);
      await evaluate(`Array.from(document.querySelectorAll('[aria-label="视频编辑区"] button')).find(b=>b.textContent==='适应全片').click()`);
      await until(`document.querySelector('[class*="cuttingViewport"]').scrollWidth<=document.querySelector('[class*="cuttingViewport"]').clientWidth+3`);
      await evaluate(`(() => {document.querySelector('video').currentTime=150;document.querySelector('[aria-label="视频编辑区"] [aria-pressed]').click();})()`);
      await until(`Number(document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow'))===150`);
      await until(`!Array.from(document.querySelectorAll('[aria-label="视频编辑区"] button')).find(b=>b.textContent==='在播放头拆分').disabled`);
      await click('在播放头拆分');
      await until(`document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length===2`);
      const split = await evaluate(`Array.from(document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]')).map(b=>b.textContent)`);
      assert.ok(split[0].includes('源帧 0–149') && split[1].includes('源帧 150–300'), JSON.stringify(split));
      const from = await evaluate(`(() => {const r=document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]')[1].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      const to = await evaluate(`(() => {const r=document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]')[0].getBoundingClientRect();return {x:r.left+5,y:r.top+r.height/2};})()`);
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',...from});
      await cdp('Input.dispatchMouseEvent', {type:'mousePressed',...from,button:'left',clickCount:1});
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',...to,button:'left',buttons:1});
      assert.ok(await evaluate(`document.querySelector('[class*="cuttingInsert"]')!==null`), 'drag should show insertion preview');
      await cdp('Input.dispatchMouseEvent', {type:'mouseReleased',...to,button:'left',clickCount:1});
      await until(`Array.from(document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]'))[0]?.textContent.includes('源帧 150–300')`);
      const seekTarget = await evaluate(`(() => {const r=document.querySelector('[aria-label="片段上方定位区"]').getBoundingClientRect();return {x:r.left+r.width*.498,y:r.top+r.height/2};})()`);
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',...seekTarget});
      await cdp('Input.dispatchMouseEvent', {type:'mousePressed',...seekTarget,button:'left',clickCount:1});
      await cdp('Input.dispatchMouseEvent', {type:'mouseReleased',...seekTarget,button:'left',clickCount:1});
      await delay(800);
      const seekState = await evaluate(`(() => {const ruler=document.querySelector('[aria-label="片段上方定位区"]'),track=document.querySelector('[class*="cuttingTrack"]');return {time:document.querySelector('video').currentTime,ruler:ruler.getBoundingClientRect().toJSON(),track:track.getBoundingClientRect().toJSON(),scroll:ruler.closest('[class*="cuttingViewport"]').scrollLeft,head:document.querySelector('[class*="cuttingPlayhead"]')?.style.left,clips:Array.from(document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]')).map(b=>b.textContent)};})()`);
      assert.ok(seekState.time > 298, JSON.stringify(seekState));
      await evaluate(`(async()=>{const video=document.querySelector('video');video.muted=true;await video.play();})()`, true);
      try { await until(`document.querySelector('video').currentTime<30 && /成片 00:02:(3[1-9]|4\\d|5\\d)/.test(document.querySelector('[class*="transport"]')?.textContent ?? '')`, 12000); }
      catch (error) {
        console.error('Playback boundary state:', await evaluate(`({time:document.querySelector('video').currentTime,paused:document.querySelector('video').paused,transport:document.querySelector('[class*="transport"]')?.textContent,clips:Array.from(document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]')).map(b=>b.textContent)})`));
        throw error;
      }
      await evaluate(`document.querySelector('video').pause()`);
      await click('删除片段');
      await until(`document.querySelectorAll('[aria-label="视频编辑区"] [aria-pressed]').length===1`);
      await evaluate(`document.querySelector('[class*="cuttingViewport"]').scrollLeft=0`);
      await delay(200);
      const edge = await evaluate(`(() => {const r=document.querySelector('[aria-label="视频编辑区"] [aria-label$="起点"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      const edgeTarget = await evaluate(`(() => {const r=document.querySelector('[aria-label="视频编辑区"] [class*="cuttingTrack"]').getBoundingClientRect();return {x:r.left+r.width*.2,y:${edge.y}};})()`);
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',...edge});
      await cdp('Input.dispatchMouseEvent', {type:'mousePressed',...edge,button:'left',clickCount:1});
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',...edgeTarget,button:'left',buttons:1});
      const trimPreview = await evaluate(`({edge:document.querySelector('[class*="cuttingTrimPreview"]')?.textContent,clip:document.querySelector('[aria-label="视频编辑区"] [aria-pressed]')?.textContent,sourceTime:document.querySelector('video').currentTime})`);
      assert.ok(trimPreview.edge, JSON.stringify({ edge, edgeTarget, trimPreview }));
      await cdp('Input.dispatchMouseEvent', {type:'mouseReleased',...edgeTarget,button:'left',clickCount:1});
      await until(`!document.querySelector('[aria-label="视频编辑区"] [aria-pressed]')?.textContent.includes('源帧 0–149')`);
      const trimmed = await evaluate(`document.querySelector('[aria-label="视频编辑区"] [aria-pressed]').textContent`);
      assert.match(trimmed, /源帧 [1-9]\d*–149/);
      console.log('Cutting step three passed: split, drag reorder and insertion preview, continuous playback across reordered clips, delete, edge trim.');
      return;
    }
    if (process.argv.includes('--cutting-step-one') || process.argv.includes('--cutting-step-two')) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await until(`document.querySelector('[aria-label="视频编辑区"] button') && document.querySelector('video')?.readyState>=2`);
      if (process.argv.includes('--cutting-step-two')) await until(`document.querySelector('[aria-label="视频编辑区"] [aria-pressed]')?.textContent.includes('源帧 0–300')`);
      const geometry = await evaluate(`(() => {const a=document.querySelector('[aria-label="视频编辑区"]').getBoundingClientRect();const b=document.querySelector('canvas[role="slider"]').getBoundingClientRect();return {cutTop:a.top,cutBottom:a.bottom,sourceBottom:b.bottom,viewport:innerHeight};})()`);
      assert.ok(geometry.cutTop >= geometry.sourceBottom && geometry.cutBottom <= geometry.viewport, `cutting strip should be visible below source frames: ${JSON.stringify(geometry)}`);
      await evaluate(`document.querySelector('video').currentTime=10`);
      await until(`Number(document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow'))===10`);
      await evaluate(`document.querySelector('[aria-label="视频编辑区"] [aria-pressed]').click()`);
      assert.ok(await evaluate(`document.querySelector('[aria-label="视频编辑区"] [aria-pressed]').getAttribute('aria-pressed')==='true' && Math.abs(document.querySelector('video').currentTime-10)<.1`), 'selecting clip must not seek');
      await evaluate(`(() => {const lane=document.querySelector('[aria-label="片段上方定位区"]');const rect=lane.getBoundingClientRect();lane.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:rect.left+rect.width/2}));})()`);
      await until(`Math.abs(document.querySelector('video').currentTime-150.5)<1 && Number(document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow'))>=149`);
      assert.ok(await evaluate(`!document.body.textContent.includes('蓝色：当前镜头 · 虚线：待保存片段选区')`));
      if (process.argv.includes('--cutting-step-two')) {
        assert.ok(await evaluate(`document.querySelector('[data-selected-source-range="0:301"]')!==null && document.body.textContent.includes('成片预览')`));
        await step(1);
        await until(`document.body.textContent.includes('查看原片')`);
        await evaluate(`(() => {const lane=document.querySelector('[aria-label="片段下方定位区"]');const rect=lane.getBoundingClientRect();lane.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:rect.left+rect.width/4}));})()`);
        await until(`document.body.textContent.includes('成片预览') && Math.abs(document.querySelector('video').currentTime-75.25)<1`);
        console.log('Cutting step two passed: source-range marker and explicit composition/source preview switching.');
      }
      console.log('Cutting step one passed: visible editing strip, select without seek, blank lane seeks and syncs source frame.');
      return;
    }
    if (process.argv.includes('--shot-highlight-only')) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(() => {
        const original=window.fetch;
        window.fetch=(url,...args)=>String(url).endsWith('/shots') ? Promise.resolve(new Response(JSON.stringify({status:'ready',frameCount:301,cuts:[{frame:18,score:1},{frame:235,score:1}]}),{headers:{'Content-Type':'application/json'}})) : original(url,...args);
      })()`);
      await until(`document.querySelectorAll('[aria-current="true"]').length===1`);
      await evaluate(`document.querySelector('video').currentTime=20`);
      await until(`document.querySelector('[data-active-shot-start="18"]')!==null`);
      await click('设为起点');
      await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('帧 20'))`);
      const selected = await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('设为起点')).textContent`);
      for (const [seconds, start, end, name] of [[6,0,18,'001'],[18,18,235,'002'],[235,235,301,'003'],[0,0,18,'001']]) {
        await evaluate(`document.querySelector('video').currentTime=${seconds}`);
        await until(`document.querySelector('[data-active-shot-start="${start}"][data-active-shot-end="${end}"]')!==null && document.querySelector('[aria-current="true"]')?.textContent.includes('${name}')`);
        assert.equal(await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('设为起点')).textContent`), selected, 'playback highlight must not alter manual clip boundaries');
      }
      await evaluate(`(async()=>{const video=document.querySelector('video');video.currentTime=17.7;video.muted=true;await video.play();})()`, true);
      await until(`document.querySelector('[data-active-shot-start="18"]')!==null && document.querySelector('[aria-current="true"]')?.textContent.includes('002')`);
      await evaluate(`document.querySelector('video').pause()`);
      console.log('Shot highlighting passed: sidebar and blue timeline interval agree at first/second/final shot and exact cuts; manual selection preserved.');
      return;
    }
    if (process.argv.includes('--view-only')) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await delay(150);
      const picture = await evaluate(`(() => {const r=document.querySelector('video').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',...picture});
      await until(`getComputedStyle(document.querySelector('[aria-label="视频播放控制"]')).visibility==='visible'`);
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',x:5,y:5});
      await until(`getComputedStyle(document.querySelector('[aria-label="视频播放控制"]')).visibility==='hidden'`);
      await cdp('Input.dispatchMouseEvent', {type:'mouseMoved',...picture});
      await until(`getComputedStyle(document.querySelector('[aria-label="视频播放控制"]')).visibility==='visible'`);
      await cdp('Input.dispatchMouseEvent', {type:'mouseWheel',...picture,deltaX:0,deltaY:100,modifiers:2});
      await until(`Number(document.querySelector('[aria-label="观察缩放"]').value)<1`);
      const ruler=await evaluate(`(() => {const r=document.querySelector('canvas[role="slider"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await cdp('Input.dispatchMouseEvent', {type:'mouseWheel',...ruler,deltaX:0,deltaY:-100,modifiers:2});
      await until(`Number(document.querySelector('[aria-label="时间轴缩放"]').value)>0`);
      assert.ok(await evaluate(`(() => {const c=document.querySelector('canvas[role="slider"]');const overview=c.parentElement.lastElementChild;return overview && overview.getBoundingClientRect().top>=c.getBoundingClientRect().bottom;})()`), 'overview should be below the frame ruler');
      console.log('View controls passed: auto hide/reveal, picture and timeline Ctrl-wheel, overview below ruler.');
      return;
    }
    if (process.argv.includes('--playhead-only')) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      const second = (await (await fetch(`${base}/api/projects/${projectId}/assets`)).json()).assets.find(item => item.type === 'video' && !item.clip && item.id !== assetId);
      assert.ok(second);
      await cdp('Page.navigate', { url: `${base}/video-editor/${projectId}/${second.id}` });
      await until(`document.body?.textContent.includes('已索引 72 帧') && document.querySelector('video').readyState>=2`);
      const result = await evaluate(`(async()=>{
        const video=document.querySelector('video'), slider=document.querySelector('canvas[role="slider"]');
        const values=new Set();
        const observer=new MutationObserver(()=>values.add(slider.getAttribute('aria-valuenow')));
        observer.observe(slider,{attributes:true,attributeFilter:['aria-valuenow']});
        video.muted=true; await video.play();
        await new Promise(resolve=>setTimeout(resolve,1300)); video.pause(); observer.disconnect();
        return {count:values.size,frames:[...values]};
      })()`, true);
      assert.ok(result.count >= 16, `24fps playhead should advance per presented frame, got ${JSON.stringify(result)}`);
      const paused = await evaluate(`document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow')`);
      await delay(250);
      assert.equal(await evaluate(`document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow')`), paused);
      const fallbackCount = await evaluate(`(async()=>{
        const video=document.querySelector('video'), slider=document.querySelector('canvas[role="slider"]');
        video.requestVideoFrameCallback=undefined; video.currentTime=0;
        await new Promise(resolve=>setTimeout(resolve,100));
        const values=new Set(); const observer=new MutationObserver(()=>values.add(slider.getAttribute('aria-valuenow')));
        observer.observe(slider,{attributes:true,attributeFilter:['aria-valuenow']});
        await video.play(); await new Promise(resolve=>setTimeout(resolve,1300));
        video.pause(); observer.disconnect(); delete video.requestVideoFrameCallback; return values.size;
      })()`, true);
      assert.ok(fallbackCount >= 16, `animation-frame fallback should also follow playback, got ${fallbackCount}`);
      console.log(`Playback playhead passed: ${result.count} frame positions in 1.3 seconds; fallback ${fallbackCount}; stable while paused.`);
      return;
    }
    if (process.argv.includes('--scrub-only')) {
      await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await delay(100);
      await step(1);
      await until(`document.querySelector('img[alt="源视频第 1 帧"]') !== null`);
      await evaluate(`document.querySelector('[aria-label="视频预览工作区"]').dispatchEvent(new PointerEvent('pointermove',{bubbles:true}))`);
      await until(`getComputedStyle(document.querySelector('[aria-label="视频播放控制"]')).visibility==='visible'`);
      assert.ok(await evaluate(`(() => {
        const image=document.querySelector('img[alt="源视频第 1 帧"]');
        const bar=document.querySelector('[aria-label="视频播放控制"]');
        const input=bar.querySelector('input'); const r=input.getBoundingClientRect();
        return image !== null && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===input
          && !Array.from(document.querySelectorAll('button')).some(b=>['上一帧','下一帧','播放'].includes(b.textContent));
      })()`), 'frame viewport must leave the progress controls visible and interactive without duplicate buttons');
      const controlShot = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(root, 'player-controls.png'), Buffer.from(controlShot.data, 'base64'));
      await step(-1);
      await until(`document.querySelector('img[alt="源视频第 0 帧"]') !== null`);
      await evaluate(`(() => { const original=window.fetch; window.__frameFetch=original; window.fetch=(url,...args)=>String(url).includes('/frames/') ? Promise.reject(new Error('Frame network disabled for cache regression')) : original(url,...args); })()`);
      await step(1);
      await until(`document.querySelector('img[alt="源视频第 1 帧"]') !== null`, 3000);
      await evaluate(`(() => { const original=window.__frameFetch; window.fetch=(url,...args)=>String(url).includes('/frames/') ? new Promise(resolve=>setTimeout(resolve,1200)).then(()=>original(url,...args)) : original(url,...args); })()`);
      const ruler = await evaluate(`(() => { const r=document.querySelector('canvas[role="slider"]').getBoundingClientRect(); return {x:r.x+r.width*.5,y:r.y+r.height*.5}; })()`);
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...ruler, button: 'left', clickCount: 1 });
      await delay(50);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...ruler, button: 'left', clickCount: 1 });
      try { await until(`Math.abs(document.querySelector('video').currentTime - 150) < 0.1`, 1000); }
      catch (error) { throw new Error(`${error.message}; ${JSON.stringify(await evaluate(`({time:document.querySelector('video').currentTime,frame:document.querySelector('canvas[role="slider"]').getAttribute('aria-valuenow'),text:document.body.innerText.slice(-1000)})`))}`); }
      assert.ok(await evaluate(`!document.querySelector('img[alt="源视频第 150 帧"]')`), 'browser preview should update before the delayed precise frame');
      await until(`!!document.querySelector('img[alt="源视频第 150 帧"]')`);
      console.log('Scrub regression passed: decoded frame revisit does not wait for network.');
      return;
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const [label, dx, dy] of [['调整左侧片段列表宽度', 60, 0], ['调整右侧片段选择宽度', -60, 0], ['调整底部时间轴高度', 0, -60]]) {
      const before = await evaluate(`(() => { const s=document.querySelector('[aria-label="${label}"]'); const r=s.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,value:Number(s.getAttribute('aria-valuenow'))}; })()`);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y });
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.x, y: before.y, button: 'left', clickCount: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x + dx, y: before.y + dy, button: 'left', buttons: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.x + dx, y: before.y + dy, button: 'left', clickCount: 1 });
      await until(`Number(document.querySelector('[aria-label="${label}"]').getAttribute('aria-valuenow')) > ${before.value + 30}`);
      await evaluate(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
    }
    assert.ok(await evaluate(`document.documentElement.scrollHeight <= innerHeight + 1`), 'workspace should fit the viewport vertically');
    const resizedShot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(root, 'resizable-workspace.png'), Buffer.from(resizedShot.data, 'base64'));
    const panelKey = `mowo:video-editor:panels:v1:${projectId}`;
    await evaluate(`document.querySelector('[aria-label="调整左侧片段列表宽度"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
    await until(`JSON.parse(localStorage.getItem(${JSON.stringify(panelKey)}) || '{}').left === 230`);
    await cdp('Page.reload');
    await until(`document.querySelector('[aria-label="调整左侧片段列表宽度"]')?.getAttribute('aria-valuenow') === '230'`);
    const otherVideo = (await (await fetch(`${base}/api/projects/${projectId}/assets`)).json()).assets.find(item => item.type === 'video' && !item.clip && item.id !== assetId);
    assert.ok(otherVideo, 'second source video available for project layout verification');
    await cdp('Page.navigate', { url: `${base}/video-editor/${projectId}/${otherVideo.id}` });
    await until(`document.querySelector('[aria-label="调整左侧片段列表宽度"]')?.getAttribute('aria-valuenow') === '230'`);
    await cdp('Emulation.setDeviceMetricsOverride', { width: 760, height: 480, deviceScaleFactor: 1, mobile: false });
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until(`document.querySelector('[aria-label="调整左侧片段列表宽度"]')?.getAttribute('aria-valuenow') === '230'`);
    await cdp('Page.navigate', { url: `${base}/video-editor/${projectId}/${assetId}` });
    await until(`document.body?.textContent.includes('已索引 301 帧')`);
    await step(1);
    await until(`document.querySelector('img[alt="源视频第 1 帧"]') !== null`);
    await step(-1);
    await until(`document.querySelector('img[alt="源视频第 0 帧"]') !== null`);
    // Revisit an already decoded frame with frame networking deliberately unavailable.
    await evaluate(`(() => { const original=window.fetch; window.__frameFetch=original; window.fetch=(url,...args)=>String(url).includes('/frames/') ? Promise.reject(new Error('Frame network disabled for cache regression')) : original(url,...args); })()`);
    await step(1);
    await until(`document.querySelector('img[alt="源视频第 1 帧"]') !== null`, 3000);
    await evaluate(`window.fetch=window.__frameFetch; delete window.__frameFetch`);
    await click('设为起点');
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('帧 1'))`);
    await step(1);
    await until(`document.querySelector('img[alt="源视频第 2 帧"]') !== null`);
    await click('设为终点');
    await until(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='仅保存到素材库')?.disabled`);
    await click('仅保存到素材库');
    await until(`document.body?.textContent.includes('已保存片段：')`);
    await step(1);
    await until(`document.querySelector('img[alt="源视频第 3 帧"]') !== null`);
    await click('设为终点');
    await until(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存并放入画布')?.disabled`);
    await click('保存并放入画布');
    await until(`location.pathname===${JSON.stringify(`/canvas/${projectId}`)}`, 90000);
    await until(`!!document.querySelector('video[aria-label*="片段"]')`, 90000);
    await until(`document.querySelector('video[aria-label*="片段"]')?.readyState>=1`);
    const start = await evaluate(`document.querySelector('video[aria-label*="片段"]').currentTime`);
    assert.ok(start >= 0.9 && start < 4, `clip should open at its own first frame, got ${start}`);
    await evaluate(`document.querySelector('video[aria-label*="片段"]').parentElement.querySelector('button[aria-label="播放视频"]').click()`, true);
    try {
      await until(`(() => { const v=document.querySelector('video[aria-label*="片段"]'); return v?.paused && v.currentTime >= 3.9; })()`, 15000);
    } catch (error) {
      const detail = await evaluate(`(() => { const v=document.querySelector('video[aria-label*="片段"]'); return {paused:v.paused,currentTime:v.currentTime,readyState:v.readyState,duration:v.duration,error:v.error?.message,visibility:document.visibilityState,button:v.parentElement.querySelector('button[aria-label]')?.getAttribute('aria-label')}; })()`);
      throw new Error(`${error.message}; player=${JSON.stringify(detail)}`);
    }
    const stopped = await evaluate(`document.querySelector('video[aria-label*="片段"]').currentTime`);
    assert.ok(stopped <= 4, `clip playback escaped its end boundary: ${stopped}`);
    await click('资产');
    await until(`Array.from(document.querySelectorAll('a')).some(a=>a.textContent==='编辑片段')`);
    await cdp('Network.enable');
    await cdp('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    await evaluate(`Array.from(document.querySelectorAll('a')).find(a=>a.textContent==='编辑片段').click()`, true);
    await until(`document.querySelector('[role="progressbar"][aria-label="正在打开视频观察页"]') !== null`, 10000);
    const loadingShot = await cdp('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(root, 'loading-progress.png'), Buffer.from(loadingShot.data, 'base64'));
    await until(`location.pathname.startsWith('/video-editor/') && document.querySelector('[aria-label="视频观察区"]') !== null`, 90000);
    await until(`document.querySelector('[role="progressbar"][aria-label="正在打开视频观察页"]') === null`);
    await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // Open the source without the initial clip selection for the draft checks below.
    await cdp('Page.navigate', { url: `${base}/video-editor/${projectId}/${assetId}` });
    await until(`document.body?.textContent.includes('已索引 301 帧')`);
    await step(1);
    await until(`document.querySelector('img[alt="源视频第 1 帧"]') !== null`);
    await click('设为起点');
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('帧 1'))`);
    await step(1);
    await until(`document.querySelector('img[alt="源视频第 2 帧"]') !== null`);
    await click('设为终点');
    await until(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='仅保存到素材库')?.disabled`);
    await evaluate(`Array.from(document.querySelectorAll('a')).find(a=>a.textContent.includes('返回画布')).click()`);
    await until(`document.querySelector('[aria-label="离开视频编辑"]') !== null`);
    await evaluate(`(() => { const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='保存草稿并返回画布'); b.click(); b.click(); })()`);
    await until(`location.pathname===${JSON.stringify(`/canvas/${projectId}`)}`, 90000);
    const draft = await (await fetch(`${base}/api/projects/${projectId}/video-editor/${assetId}/draft`)).json();
    assert.equal(draft.draft?.startFrame, 1);
    assert.equal(draft.draft?.endFrame, 3);
    await cdp('Page.navigate', { url: `${base}/video-editor/${projectId}/${assetId}` });
    await until(`document.body?.textContent.includes('发现上次保存的片段草稿')`);
    await click('恢复草稿');
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('边界 3'))`);
    console.log('Browser editor passed: exact step, both saves, bounded playback, single draft save and recovery.');
  } finally {
    socket?.close();
    if (browser.exitCode === null && browser.pid) {
      const stopped = once(browser, 'close');
      const killer = spawn('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await once(killer, 'exit');
      await stopped;
    }
  }
}
