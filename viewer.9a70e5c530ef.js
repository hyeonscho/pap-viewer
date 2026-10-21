'use strict';
const C=window.PAP_DATA.catalog, $=id=>document.getElementById(id);
const S={dataset:C.datasets[0].id,tab:'guide',call:0,frame:0,mode:'attachments',method:(C.execution?.methods?.[C.datasets[0].id]?.[0]||'direct'),episode:null,group:'all',result:'all',codeMode:'source',gt:true};
let currentTrain=null,currentEpisode=null,renderTicket=0,playTimer=null;
const E=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const J=x=>JSON.stringify(x,null,2), fmt=x=>x==null?'—':Number(x).toLocaleString();
const statusNames={removed:'기록 삭제됨',frozen:'detector 고정 완료',failed:'Train 실패',running:'진행 중',received:'응답 수신',unresolved:'응답 대기 / 미확정',correct:'정답',incorrect:'오답',runtime_error:'실행 오류',in_progress:'진행 중',interrupted:'중단',blocked_train:'Train 실패로 미실행',not_started:'미실행',retry_pending:'이전 timeout 재실행 대기'};
const methodNames={direct:'Direct',pap_pixel_detector:'PAP · pixel + detector',pap_detector_only:'PAP · detector only'};
const stageNames={discover_0:'Concept 발견',catalog_review:'Concept 검토',generate:'Detector 코드 생성',repair:'실행 feedback · 코드 수정'};
const actionNames={up:'↑ 위로 이동',down:'↓ 아래로 이동',left:'← 왼쪽으로 이동',right:'→ 오른쪽으로 이동',answer:'답하고 종료'};
const badge=s=>`<span class="badge ${['correct','frozen','received'].includes(s)?'good':['failed','incorrect','runtime_error','blocked_train','interrupted'].includes(s)?'bad':'blue'}">${E(statusNames[s]||s)}</span>`;
const ds=()=>C.datasets.find(d=>d.id===S.dataset);
const moment=t=>t?new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'—';
const color=id=>{let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;return `hsl(${h%360} 68% 42%)`};
const pendingData = new Map();
async function load(key) {
  if (window.PAP_DATA[key]) return window.PAP_DATA[key];
  const url = C.data_urls?.[key];
  if (!url) throw Error('Snapshot 데이터가 없습니다: ' + key);
  if (!pendingData.has(key)) pendingData.set(key, (async () => {
    const response = await fetch(url);
    if (!response.ok) throw Error('기록을 불러오지 못했습니다: ' + response.status);
    const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
    const value = await new Response(stream).json();
    window.PAP_DATA[key] = value;
    return value;
  })());
  return pendingData.get(key);
}
function svg(image,{origin=null,boxes=[],route=[]}={}){let p=`<svg viewBox="0 0 224 224" role="img" aria-label="관찰과 위치"><image href="${E(image)}" width="224" height="224"/>`;
 if(route.length>1)p+=`<polyline points="${route.map(o=>`${o[0]+32},${o[1]+32}`).join(' ')}" fill="none" stroke="#18a6b4" stroke-width="1.5" opacity=".7"/>`;
 if(origin)p+=`<rect x="${origin[0]}" y="${origin[1]}" width="64" height="64" fill="none" stroke="#00c5d4" stroke-width="2"/><circle cx="${origin[0]+32}" cy="${origin[1]+32}" r="2" fill="#00c5d4"/>`;
 for(const b of boxes){if(!Array.isArray(b.box)||b.box.length!==4)continue;const [x,y,x1,y1]=b.box;p+=`<rect x="${x}" y="${y}" width="${x1-x}" height="${y1-y}" fill="none" stroke="${color(b.concept_id)}" stroke-width="1.5"><title>${E(b.concept_id)}</title></rect>`;if(b.anchor)p+=`<circle cx="${b.anchor[0]}" cy="${b.anchor[1]}" r="2" fill="${color(b.concept_id)}"/>`}
 return p+'</svg>'}
function gtFigure(gt,origin,route=[]){return `<figure class="visual gt-panel ${S.gt?'':'gt-hidden'}"><h3 class="gt-title">GT <span class="badge blue">연구자 전용</span></h3><div class="gt-body">${svg(gt.full_image,{origin,route})}<figcaption><strong>정답 ${E(gt.class_id)} · ${E(gt.class_name)}</strong>${gt.group?' · '+E(gt.group):''}<br>전체 실험 canvas · source index ${E(gt.source_index)}<br>청록색: 실제 64×64 관찰 위치</figcaption></div></figure>`}
function outputFigure(image,output){const boxes=output?.result?.instances||[];return `<figure class="visual"><h3>Detector 결과 <span class="badge">연구자용 overlay</span></h3>${svg(image,{boxes})}<figcaption>${output?output.status==='ok'?`${boxes.length}개 검출 · ${fmt(output.elapsed_seconds?.toFixed(2))}초`:'코드 실행 오류 · box 없음':'이 단계에서는 detector를 실행하지 않음'}<br>Feature별 GT box는 제공되지 않습니다.</figcaption></figure>`}
function trainResultFigure(call){const cs=call.response?.concepts||call.response?.catalog?.concepts||[];const summary=call.source?'Detector code · revision '+call.revision:cs.length+'개 concept';return `<figure class="visual"><h3>이 호출에서 만든 것</h3><div class="image-empty"><span class="badge good">모델 응답</span><strong>${E(call.response?summary:'응답 대기')}</strong><span class="small muted">${call.source?'아래에서 전체 코드와 이전 버전의 diff를 볼 수 있습니다.':'아래에서 concept 정의와 근거 관찰을 볼 수 있습니다.'}</span></div><figcaption>첨부된 이미지 묶음을 본 뒤 만든 결과입니다.${call.response?.pending?.length?'<br>보류한 concept '+call.response.pending.length+'개':''}</figcaption></figure>`}
function detections(output){if(!output)return '';const rows=output.result?.instances||[];return `${output.error?`<pre class="error">${E(output.error)}</pre>`:''}<div class="detections"><table><tr><th>Concept</th><th>Box / anchor</th></tr>${rows.map(b=>`<tr><td><i class="dot" style="background:${color(b.concept_id)}"></i><button class="text-action" data-concept="${E(b.concept_id)}">${E(b.concept_id)} ↗</button></td><td>${E(J(b.box))}<br>${E(J(b.anchor))}</td></tr>`).join('')}</table></div><details><summary>Detector 출력 · 함수 실행 횟수</summary><pre>${E(J(output))}</pre></details>`}
function controls(n){return `<div class="controls"><button id="previous" aria-label="이전">←</button><button id="play">재생</button><input id="slider" aria-label="관찰 순서" type="range" min="0" max="${Math.max(0,n-1)}" value="${S.frame}"><button id="next" aria-label="다음">→</button><span class="count">${n?S.frame+1:0} / ${n}</span></div>`}
function strip(items){return `<div class="filmstrip">${items.map((a,i)=>`<button class="thumb ${i===S.frame?'active':''}" data-frame="${i}" title="${E(a.observation_id||a.logical_path||'')}"><img loading="lazy" src="${E(a.image)}" alt="관찰 ${i+1}">${a.output&&a.output.status!=='ok'?'<span class="err">!</span>':''}<small>${i+1}${a.role==='repair_overlay'?' · overlay':a.step!=null?' · step '+(a.step+1):''}</small></button>`).join('')}</div>`}
function bindFrames(n,render){saveRoute();$('previous').disabled=S.frame===0;$('next').disabled=S.frame>=n-1;$('play').textContent=playTimer?'정지':'재생';$('previous').onclick=()=>{stop();S.frame--;render()};$('next').onclick=()=>{stop();S.frame++;render()};$('slider').oninput=e=>{stop();S.frame=+e.target.value;render()};document.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>{stop();S.frame=+b.dataset.frame;render()});$('play').onclick=()=>{if(playTimer){stop();render();return}playTimer=setInterval(()=>{if(S.frame>=n-1){stop();render();return}S.frame++;render()},1000);$('play').textContent='정지'}}
function stop(){if(playTimer)clearInterval(playTimer);playTimer=null}
function trainSidebar(){const t=currentTrain;$('sidebar').innerHTML=`<div class="card"><h3>${S.dataset==='mnist'?'MNIST':'Fashion-MNIST'}</h3>${badge(t.status)}<p class="small muted">Train 원본 ${Object.keys(t.ground_truth).length}장<br>모델 호출 ${t.calls.length}회</p></div><div class="sidebar-title">모델 호출 순서</div>${t.calls.map((c,i)=>`<button class="choice ${S.call===i?'active':''}" data-call="${i}"><strong>${i+1}. ${E(stageNames[c.stage]||c.stage)}</strong><small>첨부 ${c.attachments.length}장${c.revision!=null?' · revision '+c.revision:''}</small></button>`).join('')}<div class="notice">각 항목이 한 번의 모델 호출입니다. 호출 안의 이미지들은 묶음으로 전달됐습니다.</div><div class="footer">${t.failure?E(t.failure.error||J(t.failure)):'GT class와 전체 canvas는 agent에게 전달되지 않았습니다.'}</div>`;document.querySelectorAll('[data-call]').forEach(b=>b.onclick=()=>{stop();S.call=+b.dataset.call;S.frame=0;S.mode='attachments';S.codeMode='source';trainSidebar();renderTrain()})}
function renderTrain(){saveRoute();const t=currentTrain,call=t.calls[S.call];if(!call){$('main').innerHTML='<div class="card empty">'+(t.status==='removed'?'이전 Train 기록을 삭제했습니다.':'아직 Train 호출이 없습니다.')+'</div>';return}const runtime=S.mode==='feedback',items=runtime?call.feedback:call.attachments;S.frame=Math.min(S.frame,Math.max(0,items.length-1));const a=items[S.frame],gt=a?.image_id?t.ground_truth[a.image_id]:null;const output=runtime?a?.output:null;const counts=call.feedback.reduce((r,f)=>(r[f.output.status]=(r[f.output.status]||0)+1,r),{});const concepts=call.response?.concepts||call.response?.catalog?.concepts||[];
 let body=`<div class="card"><div class="heading"><div><h2>${S.call+1}. ${E(stageNames[call.stage]||call.stage)}</h2><span class="small muted">모델 호출 ${S.call+1} / ${t.calls.length} · ${E(call.stage)}</span></div>${badge(call.status)}</div><div class="notice">${runtime?'생성 코드를 Train 관찰에 실행한 순서입니다. 여기에 나온 모든 이미지를 모델이 본 것은 아닙니다.':'아래 '+items.length+'장은 이 호출에 함께 첨부됐습니다. 슬라이더는 첨부 순서를 보여 주며, 이미지마다 새 응답이나 코드가 생긴 것은 아닙니다.'}</div><div class="tabs"><button id="attachments-mode" class="${!runtime?'active':''}">모델이 본 이미지 (${call.attachments.length})</button>${call.feedback.length?`<button id="feedback-mode" class="${runtime?'active':''}">코드 실행 결과 (${call.feedback.length})</button>`:''}</div>${controls(items.length)}`;
 if(a){body+=`<div class="viewer-grid"><figure class="visual"><h3>${runtime?'코드에 입력된 관찰':a.role==='repair_overlay'?'모델이 본 feedback overlay':'모델이 본 관찰'} <span class="badge ${runtime?'':'good'}">${runtime?'연구자용 replay':'실제 첨부 '+(a.position+1)}</span></h3>${svg(a.image)}<figcaption>${a.observation_id?'Observation '+E(a.observation_id.slice(0,12)):'첨부 '+(S.frame+1)}${a.step!=null?' · scan step '+(a.step+1):''}<br>${runtime?'Discovery에 선택된 관찰: '+(a.selected_for_discovery?'예':'아니오'):'첨부 역할: '+E(a.role)}</figcaption></figure>${gt?gtFigure(gt,a.origin):'<div class="visual empty">연결된 GT 정보 없음</div>'}${runtime?outputFigure(a.image,output):trainResultFigure(call)}</div>${strip(items)}`}
 body+=`${output?detections(output):''}${call.feedback.length?`<div class="metrics"><span class="metric">코드 실행 정상 <strong>${counts.ok||0}</strong></span><span class="metric">코드 실행 오류 <strong>${call.feedback.length-(counts.ok||0)}</strong></span><span class="metric">${E(Object.entries(counts).map(([k,v])=>k+': '+v).join(' · '))}</span><span class="metric">실행 성공은 검출 정확도를 뜻하지 않습니다.</span></div>`:''}</div>`;
 if(concepts.length)body+=`<div class="card"><h3>이 호출에서 ${call.stage==='catalog_review'?'채택한':'제안한'} concept · ${concepts.length}개</h3><p class="small muted">현재 선택한 관찰을 근거로 든 항목은 초록색으로 표시합니다. 모델의 설명이며 feature GT가 아닙니다.</p>${conceptCards(call.response,a?.observation_id)}${call.response?.pending?.length?`<details><summary>보류한 concept · ${call.response.pending.length}개</summary><pre>${E(J(call.response.pending))}</pre></details>`:''}</div>`;
 body+=codePanel(call)+`<div class="card"><h3>호출 입력과 실제 응답</h3>${callDetails(call)}</div>`;$('main').innerHTML=body;
 $('attachments-mode').onclick=()=>{stop();S.mode='attachments';S.frame=0;renderTrain()};if($('feedback-mode'))$('feedback-mode').onclick=()=>{stop();S.mode='feedback';S.frame=0;renderTrain()};if($('source-code')){$('source-code').onclick=()=>{S.codeMode='source';renderTrain()};$('diff-code').onclick=()=>{S.codeMode='diff';renderTrain()}}bindFrames(items.length,renderTrain)
}
function selectedEpisodes(){return ds().episodes.filter(e=>e.method===S.method&&(S.group==='all'||e.group===S.group)&&(S.result==='all'||e.status===S.result))}
function testSidebar(){const all=ds().episodes.filter(e=>e.method===S.method),done=completed(all);$('sidebar').innerHTML=`<div class="card"><h3>Test episodes</h3>${ds().method_sources?.[S.method]?.baseline?'<p class="small muted">이전 실행 결과 · 이번 재실행에서 제외</p>':''}<select id="method" style="width:100%">${Object.entries(methodNames).filter(([k])=>ds().episodes.some(e=>e.method===k)).map(([k,v])=>`<option value="${k}" ${S.method===k?'selected':''}>${E(v)}</option>`).join('')}</select><div class="progress"><div style="width:${done.length/all.length*100}%"></div></div><p class="small muted">완료 ${done.length} / ${all.length}${done.length?` · 평균 관찰 ${(done.reduce((n,e)=>n+e.steps,0)/done.length).toFixed(2)}회`:' · 아직 완료된 결과 없음'}</p><h4>성공률 · class 정답 기준</h4><dl class="success-rates">${[['all','전체'],['seen','Seen class'],['unseen','Unseen class']].map(([group,label])=>`<div data-rate-group="${group}"><dt>${label}</dt><dd class="accuracy">${successRate(group==='all'?all:all.filter(e=>e.group===group))}</dd></div>`).join('')}</dl><p class="small muted">완료된 episode 기준입니다. 최종 실행 오류는 실패로 포함하고, 미완료·재실행 대기는 제외합니다.</p><p class="small muted">Seen은 Train에서 본 class, Unseen은 보지 않은 class입니다. Test 이미지는 모두 Train과 다릅니다.</p></div><p class="small muted">아래 필터는 목록에만 적용됩니다. 성공률은 선택한 조건의 전체 Test 기준입니다.</p><div class="filters"><select id="group"><option value="all">Seen + unseen</option><option value="seen" ${S.group==='seen'?'selected':''}>Seen</option><option value="unseen" ${S.group==='unseen'?'selected':''}>Unseen</option></select><select id="result"><option value="all">모든 상태</option>${['correct','incorrect','in_progress','runtime_error','retry_pending','blocked_train','not_started'].filter(x=>all.some(e=>e.status===x)).map(x=>`<option value="${x}" ${S.result===x?'selected':''}>${E(statusNames[x])}</option>`).join('')}</select></div>${selectedEpisodes().map(e=>`<button class="choice episode-choice ${S.episode===e.key?'active':''}" data-episode="${E(e.key)}"><img src="${E(e.full_image)}" loading="lazy" alt="연구자용 GT"><span><strong>#${e.number} · GT ${e.class_id} · ${E(e.class_name)}</strong><small>${E(e.group)} · ${E(statusNames[e.status])}${e.steps?' · '+e.steps+' step':''}</small></span></button>`).join('')}<div class="footer">Seen/Unseen은 detector 생성 Train의 class 기준입니다. 목록의 정답과 전체 이미지는 연구자용입니다.</div>`;
 $('method').onchange=e=>{stop();S.method=e.target.value;S.episode=null;S.frame=0;render()};for(const id of ['group','result'])$(id).onchange=e=>{S[id]=e.target.value;S.episode=null;S.frame=0;render()};document.querySelectorAll('[data-episode]').forEach(b=>b.onclick=()=>{stop();S.episode=b.dataset.episode;S.frame=0;render()})}
function renderTest(){const e=currentEpisode,frames=e.frames;S.frame=Math.min(S.frame,frames.length-1);const f=frames[S.frame],call=f.call,decision=f.decision,gt=e.ground_truth,pixels=call?.attachments.some(a=>a.actually_attached&&a.artifact.media_type==='image/png');const boxes=f.detector?.result?.instances||[];const done=e.completion;
 let body=`<div class="card"><div class="heading"><div><h2>${E(methodNames[e.method])} · 관찰 ${S.frame+1}</h2><span class="small muted">${E(gt.group)} · episode ${E(e.image_id.slice(0,12))} · ${moment(f.time)}</span></div>${badge(e.status)}</div>${e.previous_completion?'<div class="notice warning">이전 timeout 기록입니다. 재실행 결과가 확정될 때까지 완료 수와 정확도에서 제외합니다.</div>':''}<div class="metrics"><span class="metric">기록된 관찰 <strong>${frames.length}</strong> / 36</span><span class="metric">Episode token <strong>${fmt(e.tokens)}</strong></span>${done?`<span class="metric">최종 답 <strong>${E(done.prediction?.class_id??'없음')}</strong></span><span class="metric">종료 ${E(done.termination)}</span>`:'<span class="metric">최종 답은 아직 기록되지 않음</span>'}</div><div class="notice">H=1 · ${e.method==='pap_detector_only'?'Agent는 현재 detector 출력과 이전 텍스트 기록을 받습니다. 아래 관찰 이미지는 연구자에게만 보입니다.':'Agent는 현재 이미지 한 장'+(e.method==='pap_pixel_detector'?'과 현재 detector 출력':'')+', 이전 텍스트 기록을 받습니다.'}</div>${controls(frames.length)}<div class="viewer-grid"><figure class="visual"><h3>${pixels?'Agent가 본 현재 이미지':'현재 환경 이미지'} <span class="badge ${pixels?'good':'blue'}">${pixels?'실제 첨부':'연구자 전용 · agent 미첨부'}</span></h3>${svg(f.image)}<figcaption>${E(f.observation_id)} · 이전 행동 ${E(actionNames[f.previous_action]||f.previous_action||'시작')}<br>이번 호출의 이미지 첨부 ${call?.attachments.length??'미확정'}장</figcaption></figure>${gtFigure(gt,f.origin,frames.slice(0,S.frame+1).map(x=>x.origin))}${e.method==='direct'?`<figure class="visual"><h3>이번 관찰의 결정</h3><div class="image-empty"><span class="badge">Agent 출력</span><strong>${E(actionNames[decision?.action]||decision?.action||'응답 대기')}</strong>${decision?.class_id!=null?`<span>예측 class ${E(decision.class_id)}</span>`:''}<span class="small muted">${decision?.evidence_ids?.length?'근거 '+E(decision.evidence_ids.join(', ')):'이동 또는 종료 결정'}</span></div><figcaption>기록된 응답을 그대로 표시합니다.</figcaption></figure>`:outputFigure(f.image,f.detector)}</div><div class="decision"><strong>${E(actionNames[decision?.action]||decision?.action||'아직 승인된 결정 없음')}${decision?.class_id!=null?' · 예측 '+decision.class_id:''}</strong><p>${E(decision?.state_note||call?.response?.state_note||'이 시점의 모델 응답이 아직 없습니다.')}</p></div>${f.errors.length?`<pre class="error">${E(J(f.errors))}</pre>`:''}<details><summary>연구자용 관찰 이력 · 이전 이미지들은 현재 agent 입력에 포함되지 않음</summary>${strip(frames)}</details>${f.detector?detections(f.detector):''}</div><div class="card"><h3>Agent 입력과 응답</h3>${callDetails(call)}<details><summary>앞선 관찰에서 agent가 남긴 텍스트</summary>${frames.slice(0,S.frame).map(x=>`<div class="history-row"><strong>${E(x.observation_id)} · ${E(actionNames[x.decision?.action]||'')}</strong><br>${E(x.decision?.state_note||'')}</div>`).join('')||'<p>첫 관찰이므로 이전 기록이 없습니다.</p>'}</details>${f.transition?`<details><summary>환경에서 실제로 처리한 이동</summary><pre>${E(J(f.transition))}</pre></details>`:''}${e.result_file?`<p class="small"><a target="_blank" href="${E(e.result_file)}">Episode 최종 결과 원문</a></p>`:''}</div>`;
 $('main').innerHTML=body;bindFrames(frames.length,renderTest)
}
// Human-authored reading aids; original model definitions remain visible below.
const conceptNotes = {
  batch0_vertical_dark_band: ['│', '세로로 이어진 어두운 획', '양쪽에 밝은 배경이 보이는 세로 획입니다. 약간 기울어진 획도 포함합니다.'],
  batch0_horizontal_dark_band: ['─', '가로로 이어진 어두운 획', '위아래 경계가 대체로 평행한 가로 획입니다.'],
  batch0_dark_band_rising_right: ['╱', '오른쪽 위로 올라가는 획', '왼쪽 아래에서 오른쪽 위로 이어지는 어두운 획입니다.'],
  batch0_left_to_down_elbow: ['┐', '왼쪽에서 아래로 꺾이는 획', '왼쪽 팔과 아래쪽 팔이 연결되고, 안쪽의 밝은 부분이 보이는 꺾임입니다.'],
  batch0_up_to_right_elbow: ['└', '위쪽에서 오른쪽으로 꺾이는 획', '위쪽 팔과 오른쪽 팔이 연결되고, 오른쪽 위의 밝은 안쪽 경계가 보이는 꺾임입니다.'],
  batch0_rounded_downward_tip: ['∪', '아래쪽의 둥근 획 끝', '세로 획이 아래에서 둥글게 끝나며, 끝부분 아래의 밝은 배경이 보입니다.'],
  batch0_vertical_boundary_bright_right: ['◧', '오른쪽이 밝은 세로 경계', '왼쪽은 어둡고 오른쪽은 밝은 세로 방향의 경계입니다.'],
  batch0_vertical_boundary_bright_left: ['◨', '왼쪽이 밝은 세로 경계', '왼쪽은 밝고 오른쪽은 어두운 세로 방향의 경계입니다.'],
  batch0_upper_left_shoulder: ['╭', '왼쪽 위에서 휘는 경계', '왼쪽의 세로 경계가 위에서 오른쪽으로 휘는 모양입니다. 옷의 어깨라는 의미를 판정하지는 않습니다.'],
  batch0_upper_right_shoulder: ['╮', '오른쪽 위에서 휘는 경계', '위쪽 곡선이 오른쪽으로 내려오며 세로 경계에 이어지는 모양입니다.'],
  batch0_bright_horizontal_lower_rim: ['═', '아래 경계의 밝은 가로 띠', '밝은 영역의 아래 경계에 좁고 밝은 가로 띠가 있고, 그 아래는 어둡습니다.'],
  batch0_upright_dark_slit: ['║', '밝은 부분 사이의 좁은 세로 무늬', '밝은 양옆 사이에 어둡고 좁은 세로 무늬가 있습니다. 실제 틈이나 지퍼라고 판단하는 것은 아닙니다.']
};
const datasetName = id => id === 'mnist' ? 'MNIST' : 'Fashion-MNIST';
const concepts = () => currentTrain?.program?.catalog?.concepts || [];
const noteFor = c => conceptNotes[c.id] || ['◇', c.id, c.definition];
const ratio = rows => rows.length ? `${(100 * rows.filter(e => e.status === 'correct').length / rows.length).toFixed(1)}%` : '—';
const completed = rows => rows.filter(e => e.completion);
function successRate(rows) {
  const done = completed(rows), correct = done.filter(e => e.status === 'correct').length;
  return `${ratio(done)}<small>${correct}/${done.length} 정답</small>`;
}
function navButton(tab, label, extra = '') { return `<button class="text-action" data-tab="${tab}" ${extra}>${label} <span>↗</span></button>`; }
function numberedCode(source, start = 1, diff = false) {
  return `<pre class="source-code" tabindex="0"><code>${source.split('\n').map((line, i) => `<span class="source-line ${diff ? line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : line.startsWith('@') ? 'info' : '' : ''}"><span class="line-number" aria-hidden="true">${start + i}</span><span>${E(line)}</span></span>`).join('')}</code></pre>`;
}
function rawLinks(call) {
  return `<div class="artifact-links"><a href="${E(call.prompt_file)}" download="${E(call.stage)}_prompt.txt">Prompt ↓</a><a href="${E(call.schema_file)}" target="_blank" rel="noopener">Response schema ↗</a>${call.response_file ? `<a href="${E(call.response_file)}" download="${E(call.stage)}_response.json">Response ↓</a>` : ''}</div>`;
}
function callDetails(call) {
  if (!call) return '<div class="notice">이 관찰의 모델 호출은 snapshot에 없습니다.</div>';
  const usage = call.outcome?.usage;
  return `<div class="metrics"><span class="metric"><strong>${fmt(usage?.input_tokens)}</strong>input tokens</span><span class="metric"><strong>${fmt(usage?.output_tokens)}</strong>output tokens</span><span class="metric">${E(call.model)} / ${E(call.effort)}</span>${badge(call.status)}</div>${rawLinks(call)}<details><summary>Prompt 전체 · 이전 텍스트 기록 포함</summary><pre tabindex="0">${E(call.prompt)}</pre></details><details><summary>모델 응답 · usage 원문</summary><pre tabindex="0">${E(J({response: call.response, outcome: call.outcome}))}</pre></details><div class="footer">Audit sequence ${call.sequence} · ${moment(call.time)}${call.recovered ? ' · 복구 시각' : ''}<br>Request ${E(call.request_digest)}</div>`;
}
function codePanel(call) {
  if (!call.source) return '';
  const diff = S.codeMode === 'diff';
  return `<div class="card"><div class="codebar"><h3>생성된 코드 · revision ${call.revision}</h3><button id="source-code" class="${!diff ? 'active' : ''}">전체 코드</button><button id="diff-code" class="${diff ? 'active' : ''}">이전 버전과 diff</button><a href="${E(call.source_file)}" download="${S.dataset}_revision_${call.revision}.py">코드 다운로드 ↓</a></div>${call.validation_error ? `<pre class="error">${E(call.validation_error)}</pre>` : ''}${numberedCode(diff ? call.diff : call.source, 1, diff)}</div>`;
}
function conceptCards(response, obs) {
  const items = response?.concepts || response?.catalog?.concepts || [];
  return items.map(c => `<div class="concept">${concepts().some(item => item.id === c.id) ? `<button class="text-action" data-concept="${E(c.id)}">${E(noteFor(c)[1])} ↗</button>` : `<strong>${E(c.id)}</strong><span class="badge">최종 catalog에 포함되지 않은 후보</span>`}<div class="short-id">${E(c.id)}</div><p>${E(c.definition)}</p>${['positives', 'negatives'].map(kind => (c[kind] || []).map(ex => `<button class="evidence evidence-link ${ex.observation_id === obs ? 'match' : ''}" data-observation="${E(ex.observation_id)}"><strong>${kind === 'positives' ? 'Positive' : 'Negative'}</strong> · ${E(ex.observation_id.slice(0, 12))} ↗<br>${E(ex.evidence)}</button>`).join('')).join('')}<details><summary>검출 규칙 원문</summary><pre>${E(J({anchor_rule: c.anchor_rule, box_rule: c.box_rule, support_rule: c.support_rule}))}</pre></details></div>`).join('');
}
function trainObservation(id) {
  for (const call of currentTrain.calls) {
    const item = call.attachments.find(a => a.observation_id === id && a.role !== 'repair_overlay');
    if (item) return item;
  }
  return currentTrain.calls.flatMap(c => c.feedback).find(f => f.observation_id === id);
}
function evidenceCard(ex, positive) {
  const a = trainObservation(ex.observation_id);
  const attached = currentTrain.calls.map((call, index) => ({call, index})).filter(({call}) => call.attachments.some(a => a.observation_id === ex.observation_id && a.role !== 'repair_overlay'));
  return `<article class="evidence-card"><div class="evidence-label ${positive ? 'good' : ''}">${positive ? 'POSITIVE · 이 모양의 근거' : 'NEGATIVE · 구분할 모양'}</div>${a ? svg(a.image) : '<div class="image-empty">기록된 관찰 이미지 없음</div>'}<p>${E(ex.evidence)}</p><div class="short-id">${E(ex.observation_id)}</div><div class="small muted">최종 catalog가 인용한 관찰</div><div class="attachment-links">${attached.map(({call, index}) => `<button data-observation="${E(ex.observation_id)}" data-at-call="${index}">${E(stageNames[call.stage] || call.stage)} ↗</button>`).join('')}</div><div class="small muted">위 호출에 실제 이미지 첨부</div></article>`;
}
function librarySidebar() {
  $('sidebar').innerHTML = `<div class="sidebar-title">FROZEN DETECTORS · ${concepts().length}</div>${concepts().map(c => `<button class="choice concept-choice ${S.concept === c.id ? 'active' : ''}" data-concept="${E(c.id)}"><span class="shape">${E(noteFor(c)[0])}</span><span><strong>${E(noteFor(c)[1])}</strong><small>${E(c.id.replace('batch0_', ''))}</small></span></button>`).join('')}<div class="footer">한국어는 읽기를 돕는 설명입니다. 모델이 만든 영어 정의와 코드 원문을 함께 보존했습니다.</div>${navButton('train', '모든 생성 호출 보기')}`;
}
function libraryCode(c) {
  const p = currentTrain.program, fn = p.functions.find(f => f.name === S.function);
  const text = fn ? p.source.split('\n').slice(fn.start - 1, fn.end).join('\n') : p.source;
  return `<div class="heading"><div><h3>Test에서 재사용한 고정 코드</h3><p class="muted small">함수 이름은 원문에서 추출했습니다. Helper를 누르면 같은 파일의 구현으로 이동합니다.</p></div><a class="download" href="${E(p.source_file)}" download="${S.dataset}_pap.py">pap.py 다운로드 ↓</a></div><div class="codebar"><select id="function-select" aria-label="코드 함수 선택"><option value="">전체 파일 · ${p.source.split('\n').length}줄</option>${p.functions.map(f => `<option value="${E(f.name)}" ${fn?.name === f.name ? 'selected' : ''}>${E(f.name)} · L${f.start}</option>`).join('')}</select><button data-function="${E('detect_' + c.id)}">이 detector</button><button data-function="perceive">perceive</button><button id="copy-code">코드 복사</button></div>${fn ? `<div class="dependency-row"><span>직접 호출하는 함수</span>${fn.calls.map(name => `<button data-function="${E(name)}">${E(name)} ↗</button>`).join('') || '<span class="muted">이 파일의 helper 호출 없음</span>'}</div>` : ''}${numberedCode(text, fn?.start || 1)}<details><summary>고정 artifact · hash</summary><p class="short-id">Source SHA256 ${E(p.source_sha256)}<br>Catalog SHA256 ${E(p.catalog_sha256)}<br>Freeze ${E(currentTrain.freeze)}</p><a href="${E(p.catalog_file)}" download="${S.dataset}_catalog.json">최종 catalog 다운로드 ↓</a></details><div class="revision-links">${currentTrain.calls.map((call, i) => call.source ? `<button data-call-link="${i}">${E(stageNames[call.stage] || call.stage)} · revision ${call.revision} · diff ↗</button>` : '').join('')}</div>`;
}
function conceptTestHits(id) {
  if (ds().detector_hits) return (ds().detector_hits[id] || []).map(h => ({e:ds().episodes.find(e => e.key === h.key), f:{image:h.image}, frame:h.frame, boxes:h.boxes}));
  const hits = [];
  for (const e of ds().episodes.filter(e => e.method !== 'direct' && e.steps)) {
    const episode = window.PAP_DATA[e.key];
    for (const [frame, f] of episode.frames.entries()) {
      const boxes = (f.detector?.result?.instances || []).filter(b => b.concept_id === id);
      if (boxes.length) hits.push({e, f, frame, boxes});
    }
  }
  return hits;
}
function libraryTests(c) {
  const hits = conceptTestHits(c.id), size = 9;
  S.hitPage = Math.max(0, Math.min(S.hitPage || 0, Math.ceil(hits.length / size) - 1));
  return `<div class="heading"><div><h3>이 detector가 출력을 낸 Test 관찰</h3><p class="muted">${hits.length}개 관찰 · ${new Set(hits.map(h => h.e.key)).size}개 episode<br><span class="small">검출이 맞았다는 판정은 아닙니다. Box는 기록된 detector 출력이며 feature GT는 없습니다.</span></p></div><div class="pager"><button data-hit-page="${S.hitPage - 1}" ${S.hitPage === 0 ? 'disabled' : ''}>←</button><span>${hits.length ? S.hitPage + 1 : 0} / ${Math.ceil(hits.length / size)}</span><button data-hit-page="${S.hitPage + 1}" ${(S.hitPage + 1) * size >= hits.length ? 'disabled' : ''}>→</button></div></div><div class="evidence-grid">${hits.slice(S.hitPage * size, (S.hitPage + 1) * size).map(({e, f, frame, boxes}) => `<button class="test-hit" data-test-key="${E(e.key)}" data-step="${frame}">${svg(f.image, {boxes})}<strong>${E(methodNames[e.method])}</strong><span>#${e.number} · 관찰 ${frame + 1} · ${E(e.group)} class</span><span>연구자용 GT ${e.class_id} · episode ${E(statusNames[e.status])}</span><span>${boxes.length}개 검출 · 입력과 결정 보기 ↗</span></button>`).join('') || '<p class="muted">이 snapshot에는 기록된 검출이 없습니다.</p>'}</div>`;
}
function renderLibrary() {
  if (!concepts().length) { $('sidebar').innerHTML = ''; $('main').innerHTML = '<div class="card empty">아직 고정된 detector가 없습니다. 생성 과정에서 현재 호출을 볼 수 있습니다.</div>'; return; }
  if (!concepts().some(c => c.id === S.concept)) S.concept = concepts()[0].id;
  const c = concepts().find(c => c.id === S.concept), note = noteFor(c);
  if (S.function === undefined) S.function = 'detect_' + c.id;
  librarySidebar();
  $('main').innerHTML = `<div class="card concept-hero"><span class="concept-symbol">${E(note[0])}</span><div><div class="eyebrow">${E(datasetName(S.dataset))} / LOCAL VISUAL CONCEPT</div><h2>${E(note[1])}</h2><div class="short-id">${E(c.id)}</div><p>${E(note[2])}</p><details><summary>모델이 정한 정의와 검출 규칙</summary><p>${E(c.definition)}</p><dl class="rules"><dt>Support</dt><dd>${E(c.support_rule)}</dd><dt>Anchor</dt><dd>${E(c.anchor_rule)}</dd><dt>Box</dt><dd>${E(c.box_rule)}</dd></dl></details></div></div><div class="tabs section-tabs">${[['evidence', '01  근거 관찰'], ['code', '02  구현 코드'], ['test', '03  Test 검출']].map(([v, label]) => `<button data-library-view="${v}" class="${(S.libraryView || 'evidence') === v ? 'active' : ''}">${label}</button>`).join('')}</div><div class="card">${S.libraryView === 'code' ? libraryCode(c) : S.libraryView === 'test' ? libraryTests(c) : `<div class="heading"><div><h3>어떤 관찰에서 이 concept을 정했나</h3><p class="muted small">최종 catalog의 Positive / Negative와 설명 원문입니다. 각 버튼에서 그 이미지를 첨부한 실제 호출로 이동합니다.</p></div></div><div class="evidence-grid">${(c.positives || []).map(ex => evidenceCard(ex, true)).join('')}${(c.negatives || []).map(ex => evidenceCard(ex, false)).join('')}</div>`}</div>`;
  if ($('function-select')) $('function-select').onchange = e => { S.function = e.target.value; renderLibrary(); saveRoute(); };
  if ($('copy-code')) $('copy-code').onclick = async () => {
    const p = currentTrain.program, f = p.functions.find(f => f.name === S.function);
    const text = f ? p.source.split('\n').slice(f.start - 1, f.end).join('\n') : p.source;
    try { await navigator.clipboard.writeText(text); $('copy-code').textContent = '복사됨'; }
    catch { $('copy-code').textContent = '복사 권한 없음 · 다운로드 사용'; }
  };
}
function renderOverview() {
  const rows = C.datasets.flatMap(d => Object.entries(d.method_sources).map(([method, source]) => {
    const all = d.episodes.filter(e => e.method === method), done = completed(all);
    return `<tr><td>${datasetName(d.id)}</td><td><button class="text-action" data-result-dataset="${E(d.id)}" data-result-method="${E(method)}">${E(methodNames[method])} ↗</button>${source.baseline ? '<small class="baseline-label">기존 실행에서 가져온 결과</small>' : ''}</td><td>${done.length}/${all.length}</td><td class="accuracy" data-rate-group="all">${successRate(all)}</td><td class="accuracy" data-rate-group="seen">${successRate(all.filter(e => e.group === 'seen'))}</td><td class="accuracy" data-rate-group="unseen">${successRate(all.filter(e => e.group === 'unseen'))}</td><td>${done.length ? (done.reduce((n, e) => n + e.steps, 0) / done.length).toFixed(2) : '—'}</td></tr>`;
  })).join('');
  return `<section class="card"><div class="heading"><div><div class="eyebrow">RESULTS</div><h2>동일 Test 이미지에서의 비교</h2></div><span class="badge">${moment(C.created_at)}</span></div><div class="result-table"><table><thead><tr><th>Dataset</th><th>Controller 입력</th><th>완료</th><th>전체 성공률</th><th>Seen class 성공률</th><th>Unseen class 성공률</th><th>평균 관찰</th></tr></thead><tbody>${rows}</tbody></table></div><p class="small muted">성공률은 class를 맞힌 episode 수 / 완료된 episode 수입니다. 최종 실행 오류는 실패로 포함하고, 미완료·재실행 대기는 제외합니다. Seen은 Train에서 본 class, Unseen은 보지 않은 class이며 Test 이미지는 모두 새 이미지입니다. 조건 이름을 누르면 관찰과 결정을 볼 수 있습니다. 세 조건은 같은 Test 이미지와 시작점을 쓰며, 이후 이동은 controller가 선택합니다.</p><details><summary>실행별 출처와 snapshot 범위</summary>${C.datasets.map(d => Object.entries(d.method_sources).map(([m, v]) => `<p class="small">${datasetName(d.id)} · ${E(methodNames[m])}${v.baseline ? ' · 기존 실행' : ''}<br><code>${E(v.root)}</code><br>Run ${E(v.run_id)} · ${moment(v.boundary.captured_at)}</p>`).join('')).join('')}</details></section>`;
}
function renderGuide() {
  const t = currentTrain, active = C.datasets.flatMap(d => d.episodes).filter(e => !e.baseline), baseline = C.datasets.flatMap(d => d.episodes).filter(e => e.baseline);
  const original = Object.values(t.ground_truth), seen = [...new Set(original.map(i => i.class_id))].sort((a,b) => a-b), unseen = [...new Set(ds().episodes.filter(e => e.group === 'unseen').map(e => e.class_id))].sort((a,b) => a-b);
  $('sidebar').innerHTML = `<div class="sidebar-title">EXPERIMENT NOTEBOOK</div><div class="context-note"><strong>${datasetName(S.dataset)}</strong><p>입력 관찰에서 고정 코드까지, 실제 기록을 따라갑니다.</p><p class="small muted">${E(ds().model)}<br>reasoning effort · ${E(ds().effort)}</p></div>${C.qualitative ? navButton('qualitative', 'Qualitative results 보기') : ''}${navButton('library', 'Detector 살펴보기')}${navButton('train', '생성 호출 원문 보기')}${navButton('test', 'Test episode 보기')}<div class="footer">${C.data_urls ? '저장된 실험 기록 · Web viewer' : '단일 HTML · 오프라인 열람'}<br>이 snapshot은 자동 갱신되지 않습니다.</div>`;
  $('main').innerHTML = `<section class="intro"><div class="eyebrow">OBSERVATION → CONCEPT → CODE → REUSE</div><h2>관찰의 공통 모양을 코드로 만들고,<br>새 이미지에서 다시 찾는다.</h2><p>Class 이름을 주지 않은 Train 관찰에서 local visual concept을 정했습니다. 생성·수정한 detector는 고정한 뒤 Test에서 실행하고, controller가 관찰 위치와 class 답을 선택했습니다.</p><div class="stat-row"><div><strong>${completed(active).length}<small> / ${active.length}</small></strong><span>현재 실행의 Test 완료</span></div><div><strong>${completed(baseline).length}</strong><span>기존 MNIST Direct 결과</span></div><div><strong>${concepts().length}</strong><span>${datasetName(S.dataset)} 고정 detector</span></div></div></section><section class="pipeline">${t.calls.map((call, i) => `<button data-call-link="${i}"><span class="step-number">0${i + 1}</span><strong>${E(stageNames[call.stage] || call.stage)}</strong><span>실제 첨부 ${call.attachments.length}장${call.source ? ` · revision ${call.revision}` : ''}</span><span class="pipeline-link">입력 → 응답 보기 ↗</span></button>`).join('')}</section><div class="two"><section class="card"><div class="eyebrow">INPUT & SPLIT</div><h3>무엇을 보았나</h3><p>224 × 224 canvas 중 64 × 64 window만 보입니다. 나머지는 회색이며, 현재 위치의 숫자 좌표는 모델에게 따로 주지 않습니다.</p><p>Train 원본 ${original.length}장 · 첫 발견 호출에 첨부한 관찰 ${t.calls[0]?.attachments.length || 0}장. Test는 방향별 32 pixel 이동, 시작 관찰을 포함해 최대 36회입니다.</p><div class="split-row"><strong>Seen class</strong><span>${seen.join(', ')}</span></div><div class="split-row"><strong>Unseen class</strong><span>${unseen.join(', ')}</span></div><p class="small muted">Seen은 detector 생성 Train에 포함된 class입니다. 동일 이미지를 다시 Test한다는 뜻이 아니며, VLM pretraining에서 본 class인지도 구분하지 않습니다.</p></section><section class="card"><div class="eyebrow">CONTROLLER INPUT</div><h3>무엇을 비교하나</h3><dl class="method-list"><dt>Direct</dt><dd>현재 이미지 + 이전 텍스트 기록</dd><dt>PAP · pixel + detector</dt><dd>현재 이미지 + concept 정의·detector 출력 + 이전 텍스트 기록</dd><dt>PAP · detector only</dt><dd>Concept 정의·detector 출력 + 이전 텍스트 기록. Controller에는 이미지가 첨부되지 않습니다.</dd></dl><p class="small muted">Detector 자체는 두 PAP 조건 모두 이미지 pixel을 읽습니다. 출력은 concept ID·anchor·box이며, controller가 이동하거나 class를 답합니다.</p></section></div>${renderOverview()}<section class="card"><div class="eyebrow">HOW TO READ THE RECORD</div><h3>화면에서 구분하는 정보</h3><div class="reading-grid"><div><span class="badge good">실제 모델 입력</span><p>호출에 첨부한 이미지, prompt, response schema를 원문과 함께 보여 줍니다.</p></div><div><span class="badge blue">연구자 전용</span><p>전체 canvas·정답·이동 경로와 viewer가 그린 overlay입니다. 모델에 첨부한 repair overlay는 별도로 표시합니다.</p></div><div><span class="badge">실행 기록</span><p>코드가 정상 실행됐다는 것과 검출이 의미상 맞는지는 다릅니다. 이 실험에는 feature별 GT box가 없습니다.</p></div></div></section>`;
}
function saveRoute() {
  const keys = ['dataset', 'tab', 'concept', 'libraryView', 'function', 'call', 'frame', 'mode', 'method', 'episode', 'group', 'result', 'codeMode', 'hitPage', 'example', 'qualConcept'];
  const query = new URLSearchParams();
  for (const key of keys) if (S[key] != null) query.set(key, S[key]);
  history.replaceState(null, '', '#' + query.toString());
}
function readRoute() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (C.datasets.some(d => d.id === q.get('dataset'))) S.dataset = q.get('dataset');
  for (const key of ['tab', 'concept', 'libraryView', 'function', 'mode', 'method', 'episode', 'group', 'result', 'codeMode', 'example', 'qualConcept']) if (q.has(key)) S[key] = q.get(key);
  for (const key of ['call', 'frame', 'hitPage']) if (q.has(key)) S[key] = Math.max(0, Number(q.get(key)) || 0);
  if (!['guide', 'qualitative', 'library', 'train', 'test'].includes(S.tab)) S.tab = 'guide';
}
async function render() {
  const ticket = ++renderTicket;
  try {
    for (const tab of ['guide', 'qualitative', 'library', 'train', 'test']) $(tab + '-tab').classList.toggle('active', S.tab === tab);
    $('overview').hidden = true;
    const d = ds();
    if (!d.episodes.some(e => e.method === S.method)) { S.method = d.episodes[0]?.method; S.episode = null; }
    if (S.result !== 'all' && !d.episodes.some(e => e.method === S.method && e.status === S.result)) S.result = 'all';
    $('dataset').value = S.dataset;
    $('model').innerHTML = `<strong>${E(d.model)}</strong><br><span class="small">${E(d.effort)} · Mlml1 quota</span>`;
    $('snapshot').textContent = 'Snapshot ' + moment(C.created_at);
    const training = await load(d.train_key);
    if (ticket !== renderTicket) return;
    currentTrain = training;
    if (S.tab === 'guide') renderGuide();
    else if (S.tab === 'qualitative') renderQualitative();
    else if (S.tab === 'library') renderLibrary();
    else if (S.tab === 'train') {
      S.call = Math.min(S.call, Math.max(0, currentTrain.calls.length - 1)); trainSidebar(); renderTrain();
    } else {
      const list = selectedEpisodes();
      if (!list.some(e => e.key === S.episode)) S.episode = list.find(e => e.steps)?.key || list[0]?.key;
      testSidebar();
      const e = list.find(e => e.key === S.episode);
      if (!e) $('main').innerHTML = '<div class="card empty">이 조건의 episode가 없습니다.</div>';
      else if (!e.steps) $('main').innerHTML = `<div class="card empty"><h2>${E(methodNames[e.method])}</h2>${badge(e.status)}<p>아직 완료된 관찰 기록이 없습니다. 미실행 episode는 정답률에서 제외합니다.</p></div>`;
      else { const episode = await load(e.key); if (ticket !== renderTicket) return; currentEpisode = episode; renderTest(); }
    }
    saveRoute();
  } catch (error) { $('main').innerHTML = '<div class="card error">' + E(error.message) + '</div>'; throw error; }
}
function openObservation(id, callIndex) {
  const candidates = currentTrain.calls.map((call, i) => ({call, i, frame: call.attachments.findIndex(a => a.observation_id === id && a.role !== 'repair_overlay')})).filter(x => x.frame >= 0);
  const selected = candidates.find(x => x.i === Number(callIndex)) || candidates[0];
  if (!selected) return;
  S.tab = 'train'; S.call = selected.i; S.frame = selected.frame; S.mode = 'attachments'; render();
}
document.addEventListener('click', event => {
  const b = event.target.closest('button'); if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.tab) { stop(); S.tab = d.tab; S.frame = 0; render(); }
  else if (d.example) { S.example = d.example; renderQualitative(); saveRoute(); $('qualitative-example').scrollIntoView({block:'start',behavior:'smooth'}); }
  else if (d.qualConcept !== undefined) { S.qualConcept = d.qualConcept; renderQualitative(); saveRoute(); }
  else if (d.concept) { stop(); S.tab = 'library'; S.concept = d.concept; S.function = 'detect_' + d.concept; S.hitPage = 0; render(); }
  else if (d.libraryView) { S.libraryView = d.libraryView; renderLibrary(); saveRoute(); }
  else if (d.function !== undefined) { S.function = d.function; renderLibrary(); saveRoute(); }
  else if (d.callLink !== undefined) { stop(); S.tab = 'train'; S.call = +d.callLink; S.frame = 0; S.mode = 'attachments'; S.codeMode = 'source'; render(); }
  else if (d.observation) { stop(); openObservation(d.observation, d.atCall); }
  else if (d.hitPage !== undefined) { S.hitPage = +d.hitPage; renderLibrary(); saveRoute(); }
  else if (d.testKey) { stop(); S.tab = 'test'; S.episode = d.testKey; S.method = ds().episodes.find(e => e.key === d.testKey).method; S.frame = +d.step; S.group = 'all'; S.result = 'all'; render(); }
  else if (d.resultDataset) { stop(); S.dataset = d.resultDataset; S.tab = 'test'; S.method = d.resultMethod; S.episode = null; S.frame = 0; S.group = 'all'; S.result = 'all'; render(); }
});
$('dataset').innerHTML = C.datasets.map(d => `<option value="${E(d.id)}">${datasetName(d.id)}</option>`).join('');
$('dataset').onchange = e => { stop(); S.dataset = e.target.value; S.call = 0; S.frame = 0; S.mode = 'attachments'; S.episode = null; S.concept = null; S.function = undefined; S.hitPage = 0; S.example = null; S.qualConcept = ''; render(); };
for (const tab of ['guide', 'qualitative', 'library', 'train', 'test']) $(tab + '-tab').onclick = () => { stop(); S.tab = tab; S.frame = 0; render(); };
$('show-gt').onchange = e => { S.gt = e.target.checked; render(); };
document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY', 'PRE'].includes(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight' && !$('next')?.disabled) $('next')?.click();
  if (e.key === 'ArrowLeft' && !$('previous')?.disabled) $('previous')?.click();
});
function qualitativeImage(example, onlyConcept = '') {
  const palette = C.qualitative.datasets[S.dataset].colors;
  const mask = 'coverage-' + example.key;
  const boxes = example.detections.filter(b => !onlyConcept || b.concept_id === onlyConcept);
  let html = `<svg viewBox="0 0 224 224" role="img" aria-label="${E(example.class_name)}의 기록된 검출"><defs><mask id="${mask}"><rect width="224" height="224" fill="white"/>${example.observations.map(o => `<rect x="${o.origin[0]}" y="${o.origin[1]}" width="64" height="64" fill="black"/>`).join('')}</mask></defs><image href="${E(example.full_image)}" width="224" height="224"/><rect width="224" height="224" fill="#dce3f1" fill-opacity=".86" mask="url(#${mask})"/>`;
  for (const b of boxes) {
    const [x, y, x1, y1] = b.box, color = palette[b.concept_id];
    html += `<rect x="${x}" y="${y}" width="${x1-x}" height="${y1-y}" fill="none" stroke="white" stroke-width="2.2"/><rect x="${x}" y="${y}" width="${x1-x}" height="${y1-y}" fill="none" stroke="${color}" stroke-width="1.1"/><circle cx="${b.anchor[0]}" cy="${b.anchor[1]}" r="1.65" fill="${color}" stroke="white" stroke-width=".6"><title>${E(b.concept_id)}</title></circle>`;
  }
  return html + '</svg>';
}
function renderQualitative() {
  const q = C.qualitative;
  if (!q) { $('sidebar').innerHTML = ''; $('main').innerHTML = '<div class="card empty">이 snapshot에는 qualitative 자료가 없습니다.</div>'; return; }
  const current = q.datasets[S.dataset], examples = current.examples;
  if (!examples.some(e => e.key === S.example)) S.example = examples[0].key;
  const example = examples.find(e => e.key === S.example);
  $('sidebar').innerHTML = `<div class="sidebar-title">QUALITATIVE RESULTS · 2 SLIDES</div><div class="context-note"><strong>같은 concept을 새 이미지에서 찾는가</strong><p>Train에서 고정한 detector를 Test에 적용한 결과를 직접 살펴봅니다.</p></div><div class="sidebar-title">CLASS별 TEST 예시</div>${examples.map(e => `<button class="choice qualitative-choice ${S.example === e.key ? 'active' : ''}" data-example="${e.key}"><span class="class-marker ${e.group}">${e.class_id}</span><span><strong>${E(e.class_name)}</strong><small>${e.group} class · ${e.observations_used}회 관찰</small></span></button>`).join('')}<div class="footer">모두 새로운 Test 이미지입니다.<br>테두리는 class의 Train 포함 여부입니다.</div>`;
  const legend = concepts().map(c => `<button class="legend-concept ${S.qualConcept === c.id ? 'active' : ''}" data-qual-concept="${E(c.id)}"><i style="background:${current.colors[c.id]}"></i>${E(noteFor(c)[1])}</button>`).join('');
  $('main').innerHTML = `<section class="card qualitative-heading"><div class="eyebrow">QUALITATIVE RESULTS / FROZEN DETECTOR REUSE</div><h2>서로 다른 class에서도 같은 concept을 찾는가</h2><p>Class별 첫 Test 이미지에 저장된 detector 출력을 모았습니다. Seen·Unseen class에서 같은 형태에 반응하는지, 놓치거나 다른 형태에 반응하는지를 눈으로 살펴볼 수 있습니다.</p><div class="artifact-links"><a href="${E(current.slide)}" target="_blank" rel="noopener">슬라이드 확대 ↗</a></div><a href="${E(current.slide)}" target="_blank" rel="noopener"><img class="qualitative-slide" src="${E(current.slide)}" alt="${E(datasetName(S.dataset))} qualitative results 최종 v2 슬라이드"></a><details><summary>선택 기준과 그림을 읽는 방법</summary><p>각 dataset의 기존 Test manifest에서 class별 첫 이미지를 골랐습니다. 검출이 잘 된 결과를 골라 넣지 않았습니다. 모든 출력은 기존 pixel + detector 조건에서 가져왔고, 새 inference나 수동 annotation은 하지 않았습니다.</p><p>색은 concept, 점은 anchor, box는 support 영역입니다. 옅은 파란색은 경로에서 관찰하지 않은 영역입니다. 전체 canvas에 검출을 누적한 그림은 연구자용이며, detector는 매번 64×64 부분 관찰을 받았습니다.</p><p>동일한 concept ID·anchor·box의 반복만 한 번 표시했습니다. 다른 좌표의 중복이나 오검출처럼 보이는 출력도 남겼습니다. 검출 수는 물리적 feature occurrence 수나 detection accuracy가 아닙니다.</p></details></section><section class="card" id="qualitative-example"><div class="heading"><div><div class="eyebrow">INSPECT AN EXAMPLE</div><h2>${example.class_id} · ${E(example.class_name)}</h2><p class="small muted">Test · ${example.group} class · source index ${example.source_index}</p></div><button class="text-action" data-test-key="${E(example.episode_key)}" data-step="0">실제 Test 관찰과 결정 ↗</button></div><div class="qualitative-detail"><figure class="qualitative-canvas ${example.group}">${qualitativeImage(example,S.qualConcept || '')}<figcaption>남색 실선: Seen class · 주황 점선: Unseen class</figcaption></figure><div><h3>관찰된 출력</h3><div class="metrics"><span class="metric"><strong>${example.observations_used}</strong>관찰</span><span class="metric"><strong>${example.raw_detection_count}</strong>기록된 검출</span><span class="metric"><strong>${example.unique_detection_count}</strong>표시한 geometry</span></div><p class="small muted">관찰한 canvas 비율 ${(example.coverage_fraction * 100).toFixed(1)}%. 아래 feature를 누르면 해당 출력만 볼 수 있습니다.</p><div class="qualitative-legend"><button class="legend-concept ${!S.qualConcept ? 'active' : ''}" data-qual-concept="">모든 feature</button>${legend}</div><p class="small muted">이 그림은 검출 정답 annotation이 아닙니다. 새 이미지에서 코드가 재사용된 결과를 관찰하는 자료이며, 검출의 정확성은 별도 평가가 필요합니다.</p></div></div><details><summary>검출별 좌표와 근거 관찰 · ${example.detections.length}개</summary><div class="detections"><table><tr><th>Concept · 코드</th><th>Box / anchor</th><th>검출된 관찰</th></tr>${example.detections.map(b => `<tr><td><button class="text-action" data-concept="${E(b.concept_id)}">${E(noteFor({id:b.concept_id})[1])} ↗</button></td><td>${E(J(b.box))}<br>${E(J(b.anchor))}</td><td>${b.observation_ids.map(id => `<button class="observation-link" data-test-key="${E(example.episode_key)}" data-step="${example.frame_indices[id]}">${E(id)} ↗</button>`).join(' ')}</td></tr>`).join('')}</table></div></details></section><section class="card"><h3>${datasetName(S.dataset)} · class별 10개 예시</h3><div class="qualitative-grid">${examples.map(e => `<button class="qualitative-tile ${e.group} ${e.key === S.example ? 'active' : ''}" data-example="${e.key}"><img src="${E(e.full_image)}" alt="Test ${E(e.class_name)}" loading="lazy"><strong>${e.class_id} · ${E(e.class_name)}</strong><small>${e.group} class · ${e.unique_detection_count}개 geometry</small></button>`).join('')}</div></section>`;
}

$('qualitative-tab').hidden = !C.qualitative;
window.addEventListener('hashchange', () => { stop(); readRoute(); render(); });
readRoute();
render();
