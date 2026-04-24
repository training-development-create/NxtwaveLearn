import React, { useEffect, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./auth";
import { Btn, Card, Chip, Icon } from "./ui";
import type { Nav } from "./App";

const inputStyle: CSSProperties = { padding:'10px 12px', border:'1px solid #DDE4ED', borderRadius:8, fontSize:14, outline:'none', background:'#fff', fontFamily:'inherit' };

function TInput(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} style={{...inputStyle, width:'100%', ...(p.style||{})}}/>;
}
function Label({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{fontSize:12, fontWeight:700, color:'#3B4A5E', marginBottom:6, ...style}}>{children}</div>;
}

type Q = { q: string; options: string[]; correct: number; hint: string };

const TAGS = ['Mandatory','Soft Skills','Leadership','Culture','Business','General'];
const HUES = ['#0072FF','#17A674','#E08A1E','#A855F7','#EC4899','#134594'];
const EMOJIS = ['📘','🛡️','💬','🎯','🤝','📊','🔐','🎓'];

export function AdminUpload({ onNav }: { onNav: Nav }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'new'|'existing'>('new');

  const [existingCourses, setExistingCourses] = useState<{ id:string; title:string }[]>([]);
  const [existingCourseId, setExistingCourseId] = useState('');

  const [courseTitle, setCourseTitle] = useState('');
  const [tag, setTag] = useState('Mandatory');
  const [hue, setHue] = useState(HUES[0]);
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [blurb, setBlurb] = useState('');

  const [lessonTitle, setLessonTitle] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);

  const [questions, setQuestions] = useState<Q[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('courses').select('id, title').order('created_at', { ascending: true }).then(({ data }) => setExistingCourses(data || []));
  }, []);

  // Read duration from chosen file
  const onPickVideo = (f: File | null) => {
    setVideoFile(f);
    setVideoDuration(0);
    if (!f) return;
    const url = URL.createObjectURL(f);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { setVideoDuration(Math.round(v.duration || 0)); URL.revokeObjectURL(url); };
    v.src = url;
  };

  const q = questions[active];
  const update = (patch: Partial<Q>) => { const c=[...questions]; c[active]={...c[active], ...patch}; setQuestions(c); };
  const updateOpt = (i: number, v: string) => { const opts=[...q.options]; opts[i]=v; update({ options: opts }); };
  const removeQ = (idx: number) => {
    const c = questions.filter((_,i) => i !== idx); setQuestions(c);
    if (active >= c.length) setActive(Math.max(0, c.length - 1));
  };

  const onPickQuiz = async (f: File | null) => {
    if (!f) return;
    setParseError(null); setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      // safe base64 for large files
      let bin = ''; const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i=0;i<bytes.length;i+=chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i+chunk)));
      const b64 = btoa(bin);
      const { data, error } = await supabase.functions.invoke('parse-quiz', {
        body: { fileBase64: b64, mimeType: f.type || 'application/octet-stream', fileName: f.name },
      });
      if (error) {
        // supabase-js wraps non-2xx responses into a generic error message.
        // Try to extract the actual response payload/status for a helpful UI message.
        const anyErr = error as unknown as {
          message?: string;
          context?: { status?: number; body?: unknown };
        };
        const status = anyErr?.context?.status;
        const body = anyErr?.context?.body as any;
        const bodyMsg =
          typeof body === 'string'
            ? body
            : (body && typeof body === 'object' && typeof body.error === 'string')
              ? body.error
              : null;
        if (status === 503) throw new Error(bodyMsg || 'AI is under high demand right now. Please retry in 30–60 seconds.');
        if (status === 429) throw new Error(bodyMsg || 'Too many requests. Please wait a moment and retry.');
        throw new Error(bodyMsg || anyErr?.message || 'Failed to parse assessment. Please try again.');
      }
      const parsed = (data?.questions as Q[]) || [];
      if (!parsed.length) throw new Error('AI could not find any questions in this file.');
      setQuestions(parsed);
      setActive(0);
    } catch (e) {
      setParseError((e as Error).message || 'Failed to parse questions');
    } finally { setParsing(false); }
  };

  const publish = async () => {
    setSaving(true); setError(null);
    try {
      if (!videoFile) throw new Error('Please upload a video file (mandatory).');
      let courseId = existingCourseId;
      if (mode === 'new') {
        if (!courseTitle.trim()) throw new Error('Course title is required.');
        const { data, error: e1 } = await supabase.from('courses').insert({
          title: courseTitle.trim(), tag, blurb, instructor: '', hue, emoji,
          duration_label: videoDuration ? `${Math.ceil(videoDuration/60)} min` : '',
          created_by: user?.id ?? null,
          published_at: new Date().toISOString(),
        }).select('id').single();
        if (e1) throw e1;
        courseId = data.id;
      }
      if (!courseId) throw new Error('Pick or create a course.');
      if (!lessonTitle.trim()) throw new Error('Lesson title is required.');

      // Upload video
      const ext = videoFile.name.split('.').pop() || 'mp4';
      const path = `${courseId}/${crypto.randomUUID()}.${ext}`;
      setUploadPct(10);
      const { error: upErr } = await supabase.storage.from('course-videos').upload(path, videoFile, { upsert: false, contentType: videoFile.type });
      if (upErr) throw upErr;
      setUploadPct(80);

      const { count } = await supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('course_id', courseId);
      const position = count ?? 0;

      const dur = videoDuration || 360;
      const { data: lesson, error: e2 } = await supabase.from('lessons').insert({
        course_id: courseId, title: lessonTitle.trim(), duration_seconds: dur,
        video_path: path, position,
      }).select('id').single();
      if (e2) throw e2;

      const valid = questions.filter(qq => qq.q.trim() && qq.options.every(o => o.trim()));
      if (valid.length) {
        const rows = valid.map((qq, i) => ({
          lesson_id: lesson.id, question: qq.q.trim(), options: qq.options.map(o => o.trim()),
          correct_index: qq.correct, hint: qq.hint, position: i,
        }));
        const { error: e3 } = await supabase.from('mcq_questions').insert(rows);
        if (e3) throw e3;
      }
      // If existing course, also push a notification (publish trigger only fires on new course)
      if (mode === 'existing') {
        const { data: ps } = await supabase.from('profiles').select('id');
        if (ps && ps.length) {
          await supabase.from('notifications').insert(ps.map((p: { id: string }) => ({
            user_id: p.id, title: 'New lesson added', body: `${lessonTitle.trim()} — open course to watch`, link_course_id: courseId,
          })));
        }
      }
      setUploadPct(100);
      setSaving(false);
      onNav('admin-dashboard');
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div style={{padding:'28px 36px 48px', animation:'fadeUp .3s'}}>
      <div style={{display:'grid', gridTemplateColumns:'1fr 320px', gap:20}}>
        <div>
          <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:20}}>
            {([[1,'Course'],[2,'Video'],[3,'Quiz'],[4,'Publish']] as const).map(([n,l],i,arr) => (
              <React.Fragment key={n}>
                <button onClick={()=>setStep(n)} style={{display:'flex', alignItems:'center', gap:10, background:'transparent', border:0, cursor:'pointer', padding:0}}>
                  <div style={{width:32, height:32, borderRadius:99, background: step>=n?'linear-gradient(135deg,#00C6FF,#0072FF)':'#EEF2F7', color: step>=n?'#fff':'#8A97A8', display:'grid', placeItems:'center', fontWeight:800, fontSize:13}}>{step>n?'✓':n}</div>
                  <div style={{fontSize:13, fontWeight: step===n?700:500, color: step===n?'#002A4B':'#5B6A7D'}}>{l}</div>
                </button>
                {i<arr.length-1 && <div style={{flex:1, maxWidth:50, height:2, background: step>n?'#0072FF':'#EEF2F7'}}/>}
              </React.Fragment>
            ))}
          </div>

          {step===1 && (
            <Card pad={0}>
              <div style={{padding:24, borderBottom:'1px solid #EEF2F7'}}>
                <h3 style={{fontSize:18, color:'#002A4B', margin:0, fontWeight:800}}>Pick a course</h3>
                <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>Add a video to an existing course or create a new one.</div>
              </div>
              <div style={{padding:24}}>
                <div style={{display:'flex', gap:8, marginBottom:18}}>
                  <button onClick={()=>setMode('new')} style={{flex:1, padding:'12px 14px', borderRadius:10, border:`1.5px solid ${mode==='new'?'#0072FF':'#EEF2F7'}`, background: mode==='new'?'#F2F9FF':'#fff', textAlign:'left', cursor:'pointer'}}>
                    <div style={{fontSize:13, fontWeight:700, color:'#002A4B'}}>+ New course</div>
                    <div style={{fontSize:12, color:'#5B6A7D'}}>Auto-assigned to all employees on publish.</div>
                  </button>
                  <button onClick={()=>setMode('existing')} disabled={existingCourses.length===0} style={{flex:1, padding:'12px 14px', borderRadius:10, border:`1.5px solid ${mode==='existing'?'#0072FF':'#EEF2F7'}`, background: mode==='existing'?'#F2F9FF':'#fff', textAlign:'left', cursor: existingCourses.length?'pointer':'not-allowed', opacity: existingCourses.length?1:.5}}>
                    <div style={{fontSize:13, fontWeight:700, color:'#002A4B'}}>Add to existing</div>
                    <div style={{fontSize:12, color:'#5B6A7D'}}>{existingCourses.length} course{existingCourses.length===1?'':'s'} available.</div>
                  </button>
                </div>

                {mode === 'existing' ? (
                  <div>
                    <Label>Course</Label>
                    <select value={existingCourseId} onChange={e=>setExistingCourseId(e.target.value)} style={{...inputStyle, width:'100%'}}>
                      <option value="">— Pick a course —</option>
                      {existingCourses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                ) : (
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
                    <div style={{gridColumn:'1 / -1'}}><Label>Title</Label><TInput value={courseTitle} onChange={e=>setCourseTitle(e.target.value)} placeholder="POSH Awareness at Workplace"/></div>
                    <div><Label>Tag</Label><select value={tag} onChange={e=>setTag(e.target.value)} style={{...inputStyle, width:'100%'}}>{TAGS.map(t=><option key={t}>{t}</option>)}</select></div>
                    <div><Label>Color</Label><div style={{display:'flex', gap:6}}>{HUES.map(h=><button key={h} onClick={()=>setHue(h)} style={{width:30, height:30, borderRadius:8, background:h, border: hue===h?'3px solid #002A4B':'2px solid #fff', cursor:'pointer'}}/>)}</div></div>
                    <div style={{gridColumn:'1 / -1'}}><Label>Emoji</Label><div style={{display:'flex', gap:6, flexWrap:'wrap'}}>{EMOJIS.map(e=><button key={e} onClick={()=>setEmoji(e)} style={{width:36, height:36, borderRadius:8, fontSize:18, background: emoji===e?'#F2F9FF':'#fff', border:`1.5px solid ${emoji===e?'#0072FF':'#EEF2F7'}`, cursor:'pointer'}}>{e}</button>)}</div></div>
                    <div style={{gridColumn:'1 / -1'}}><Label>Description</Label><textarea rows={3} value={blurb} onChange={e=>setBlurb(e.target.value)} style={{...inputStyle, width:'100%', resize:'vertical'}} placeholder="Short summary shown on the course card."/></div>
                  </div>
                )}
              </div>
              <div style={{padding:'14px 24px', borderTop:'1px solid #EEF2F7', display:'flex', justifyContent:'flex-end'}}>
                <Btn onClick={()=>setStep(2)} disabled={mode==='existing' ? !existingCourseId : !courseTitle.trim()}>Next — Video →</Btn>
              </div>
            </Card>
          )}

          {step===2 && (
            <Card pad={0}>
              <div style={{padding:24, borderBottom:'1px solid #EEF2F7'}}>
                <h3 style={{fontSize:18, color:'#002A4B', margin:0, fontWeight:800}}>Upload the video <span style={{color:'#C2261D'}}>*</span></h3>
                <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>MP4/WebM file. Watch duration is tracked per learner so you'll know who actually watched.</div>
              </div>
              <div style={{padding:24, display:'grid', gridTemplateColumns:'1fr 1fr', gap:14}}>
                <div style={{gridColumn:'1 / -1'}}><Label>Video title</Label><TInput value={lessonTitle} onChange={e=>setLessonTitle(e.target.value)} placeholder="What POSH means — your rights at work"/></div>
                <div style={{gridColumn:'1 / -1'}}>
                  <Label>Video file (mandatory)</Label>
                  <label style={{display:'block', padding:24, border:`2px dashed ${videoFile?'#17A674':'#CCEAFF'}`, background: videoFile?'#F0FCF5':'#F7FBFF', borderRadius:12, cursor:'pointer', textAlign:'center'}}>
                    <input type="file" accept="video/*" style={{display:'none'}} onChange={e=>onPickVideo(e.target.files?.[0] || null)}/>
                    {videoFile ? (
                      <div>
                        <div style={{fontSize:32, marginBottom:6}}>🎬</div>
                        <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>{videoFile.name}</div>
                        <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>{(videoFile.size/1024/1024).toFixed(1)} MB · {videoDuration ? `${Math.floor(videoDuration/60)}m ${videoDuration%60}s` : 'reading…'}</div>
                        <div style={{marginTop:10, fontSize:12, color:'#0072FF', fontWeight:600}}>Click to change</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{fontSize:32, marginBottom:6}}>📤</div>
                        <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>Click to choose a video file</div>
                        <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>External links are not supported — uploads only</div>
                      </div>
                    )}
                  </label>
                </div>
              </div>
              <div style={{padding:'14px 24px', borderTop:'1px solid #EEF2F7', display:'flex', justifyContent:'space-between'}}>
                <Btn variant="ghost" onClick={()=>setStep(1)}>← Back</Btn>
                <Btn onClick={()=>setStep(3)} disabled={!lessonTitle.trim() || !videoFile}>Next — Quiz →</Btn>
              </div>
            </Card>
          )}

          {step===3 && (
            <Card pad={0}>
              <div style={{padding:'20px 24px', borderBottom:'1px solid #EEF2F7'}}>
                <h3 style={{fontSize:18, color:'#002A4B', margin:0, fontWeight:800}}>Upload assessment</h3>
                <div style={{fontSize:13, color:'#5B6A7D', marginTop:4}}>Upload a PDF, DOCX or TXT with questions, options & correct answers. AI will parse it automatically.</div>
              </div>
              <div style={{padding:24}}>
                <label style={{display:'block', padding:24, border:'2px dashed #CCEAFF', background:'#F7FBFF', borderRadius:12, cursor: parsing?'wait':'pointer', textAlign:'center', opacity: parsing?.7:1}}>
                  <input type="file" accept=".pdf,.docx,.doc,.txt" style={{display:'none'}} disabled={parsing} onChange={e=>onPickQuiz(e.target.files?.[0] || null)}/>
                  <div style={{fontSize:32, marginBottom:6}}>{parsing ? '🤖' : '📄'}</div>
                  <div style={{fontSize:14, fontWeight:700, color:'#0A1F3D'}}>{parsing ? 'AI is reading your file…' : 'Click to upload a PDF/DOCX/TXT'}</div>
                  <div style={{fontSize:12, color:'#5B6A7D', marginTop:4}}>Format freely — write Q1, A) B) C) D), and mark the answer.</div>
                </label>
                {parseError && <div style={{marginTop:12, padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500}}>{parseError}</div>}

                {questions.length > 0 && (
                  <div style={{marginTop:20}}>
                    <div style={{display:'flex', alignItems:'center', marginBottom:12}}>
                      <Chip color="#17A674">✓ {questions.length} question{questions.length===1?'':'s'} parsed</Chip>
                      <div style={{marginLeft:'auto', fontSize:12, color:'#5B6A7D'}}>Click any question to review/edit before publishing.</div>
                    </div>
                    <div style={{display:'grid', gridTemplateColumns:'220px 1fr', border:'1px solid #EEF2F7', borderRadius:12, overflow:'hidden'}}>
                      <div style={{borderRight:'1px solid #EEF2F7', padding:'10px 8px', maxHeight:480, overflowY:'auto', background:'#FAFBFE'}}>
                        {questions.map((qq,i) => (
                          <div key={i} style={{display:'flex', marginBottom:4}}>
                            <button onClick={()=>setActive(i)} style={{flex:1, display:'flex', gap:10, padding:'9px 10px', textAlign:'left', background: active===i?'#fff':'transparent', border: active===i?'1px solid #CCEAFF':'1px solid transparent', borderRadius:9, cursor:'pointer', alignItems:'flex-start'}}>
                              <div style={{width:22, height:22, borderRadius:6, background: active===i?'#0072FF':'#EEF2F7', color: active===i?'#fff':'#5B6A7D', display:'grid', placeItems:'center', fontWeight:800, fontSize:11, flexShrink:0}}>{i+1}</div>
                              <div style={{fontSize:12, color:'#3B4A5E', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, minWidth:0}}>{qq.q}</div>
                            </button>
                            <button onClick={()=>removeQ(i)} style={{width:26, background:'transparent', border:0, color:'#BCC6D3', cursor:'pointer', fontSize:13}}>✕</button>
                          </div>
                        ))}
                      </div>
                      <div style={{padding:18}}>
                        {q && <>
                          <Label>Question</Label>
                          <textarea rows={2} value={q.q} onChange={e=>update({q:e.target.value})} style={{...inputStyle, width:'100%', fontSize:14, color:'#002A4B', resize:'vertical'}}/>
                          <Label style={{marginTop:12}}>Options · <span style={{color:'#17A674'}}>green = correct</span></Label>
                          <div style={{display:'flex', flexDirection:'column', gap:6}}>
                            {q.options.map((opt,i) => (
                              <div key={i} style={{display:'flex', gap:8, padding:'8px 10px', border:`1.5px solid ${q.correct===i?'#17A674':'#EEF2F7'}`, background: q.correct===i?'#F0FCF5':'#fff', borderRadius:8, alignItems:'center'}}>
                                <button onClick={()=>update({correct:i})} style={{width:22, height:22, borderRadius:99, background: q.correct===i?'#17A674':'#EEF2F7', color: q.correct===i?'#fff':'#8A97A8', border:0, cursor:'pointer', fontSize:11, fontWeight:800, flexShrink:0}}>{q.correct===i?'✓':String.fromCharCode(65+i)}</button>
                                <input value={opt} onChange={e=>updateOpt(i, e.target.value)} style={{flex:1, border:0, outline:'none', fontSize:13, background:'transparent'}}/>
                              </div>
                            ))}
                          </div>
                        </>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{padding:'14px 24px', borderTop:'1px solid #EEF2F7', display:'flex', justifyContent:'space-between'}}>
                <Btn variant="ghost" onClick={()=>setStep(2)}>← Back</Btn>
                <Btn onClick={()=>setStep(4)} disabled={questions.length===0}>Next — Publish →</Btn>
              </div>
            </Card>
          )}

          {step===4 && (
            <Card pad={0}>
              <div style={{padding:40, textAlign:'center', background:'linear-gradient(180deg,#F2F9FF,#fff)', borderBottom:'1px solid #EEF2F7'}}>
                <div style={{width:72, height:72, margin:'0 auto', borderRadius:20, background:'linear-gradient(135deg,#17A674,#0E6E4A)', display:'grid', placeItems:'center', boxShadow:'0 10px 30px rgba(23,166,116,.3)'}}><Icon d="M5 13l4 4L19 7" size={32} color="#fff" stroke={3}/></div>
                <div style={{fontSize:24, fontWeight:800, color:'#002A4B', marginTop:16, letterSpacing:'-.02em'}}>Ready to publish.</div>
                <div style={{fontSize:14, color:'#5B6A7D', marginTop:4}}>Auto-assigned to every employee. They'll get a notification.</div>
              </div>
              <div style={{padding:24}}>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:18}}>
                  <Summary label="Course" value={mode==='new' ? courseTitle : (existingCourses.find(c=>c.id===existingCourseId)?.title || '—')}/>
                  <Summary label="Video" value={lessonTitle}/>
                  <Summary label="Duration" value={`${Math.floor(videoDuration/60)}m ${videoDuration%60}s`}/>
                  <Summary label="Quiz questions" value={`${questions.filter(qq=>qq.q.trim()).length}`}/>
                </div>
                {saving && uploadPct > 0 && (
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12, color:'#5B6A7D', marginBottom:6}}>Uploading video… {uploadPct}%</div>
                    <div style={{height:6, background:'#EEF2F7', borderRadius:99, overflow:'hidden'}}>
                      <div style={{width:`${uploadPct}%`, height:'100%', background:'linear-gradient(90deg,#00C6FF,#0072FF)', transition:'width .3s'}}/>
                    </div>
                  </div>
                )}
                {error && <div style={{padding:'10px 12px', background:'#FCE1DE', color:'#C2261D', borderRadius:8, fontSize:13, fontWeight:500, marginBottom:14}}>{error}</div>}
                <div style={{display:'flex', gap:10}}>
                  <Btn variant="ghost" onClick={()=>setStep(3)}>← Back</Btn>
                  <Btn variant="success" size="lg" onClick={publish} disabled={saving}>{saving ? 'Publishing…' : 'Publish ✓'}</Btn>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div>
          <Card pad={0}>
            <div style={{aspectRatio:'16/9', background:'#0A1F3D', position:'relative', display:'grid', placeItems:'center', borderRadius:'16px 16px 0 0', overflow:'hidden'}}>
              <div style={{position:'absolute', inset:0, background:'radial-gradient(circle at 30% 40%, rgba(0,198,255,.3), transparent 60%), linear-gradient(135deg, #001B30, #0B4A86)'}}/>
              <div style={{position:'relative', color:'#fff', textAlign:'center', padding:16}}>
                <div style={{fontSize:54, marginBottom:8}}>{emoji}</div>
                <div style={{fontSize:14, fontWeight:700}}>{courseTitle || 'Your course preview'}</div>
              </div>
            </div>
            <div style={{padding:16, fontSize:12, color:'#5B6A7D', lineHeight:1.6}}>
              <div style={{fontWeight:700, color:'#0A1F3D', marginBottom:6}}>How publishing works</div>
              • Every employee gets the course automatically<br/>
              • A notification fires to all learners<br/>
              • Watch duration tracked per video<br/>
              • Quiz unlocks at 90% watch
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label:string; value:string }) {
  return (
    <div style={{padding:'12px 14px', background:'#F7F9FC', borderRadius:10, border:'1px solid #EEF2F7'}}>
      <div style={{fontSize:10, fontWeight:700, color:'#8A97A8', letterSpacing:'.08em', textTransform:'uppercase'}}>{label}</div>
      <div style={{fontSize:13, fontWeight:700, color:'#0A1F3D', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{value || '—'}</div>
    </div>
  );
}
