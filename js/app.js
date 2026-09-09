import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

var DAYS = [
  {code:'L',label:'Lunes'},{code:'M',label:'Martes'},{code:'X',label:'Miércoles'},
  {code:'J',label:'Jueves'},{code:'V',label:'Viernes'},{code:'S',label:'Sábado'},{code:'D',label:'Domingo'}
];
var DOW_MAP = ['D','L','M','X','J','V','S'];
var TIPO_LABEL = {actividad:'Actividad',excursion:'Excursión',reunion:'Reunión',festivo:'Cierre'};
var MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
var MESES_ABR = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

function todayISO(){
  var d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function weekdayCode(dateStr){
  var d = new Date(dateStr+'T00:00:00');
  return DOW_MAP[d.getDay()];
}

var state = {
  children:[],
  events:[],
  attendance:[],
  calYear:new Date().getFullYear(),
  calMonth:new Date().getMonth(),
  selectedDate:todayISO(),
  editingChildId:null
};

var db = null;
var childrenCol, eventsCol, attendanceCol;

// ---------- tabs ----------
document.querySelectorAll('.tab-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.toggle('active', b===btn);});
    document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('active', p.id==='panel-'+btn.dataset.tab);});
  });
});

// ---------- day checkboxes for child form ----------
var chDaysEl = document.getElementById('chDays');
DAYS.forEach(function(d){
  var wrap = document.createElement('label');
  wrap.className = 'day-check';
  wrap.innerHTML = '<input type="checkbox" value="'+d.code+'"><span>'+d.code+'</span>';
  wrap.title = d.label;
  chDaysEl.appendChild(wrap);
});

document.getElementById('asisFecha').value = state.selectedDate;

// ================= CALENDAR =================
function renderCalendar(){
  document.getElementById('calTitle').textContent = MESES[state.calMonth] + ' ' + state.calYear;

  var grid = document.getElementById('calGrid');
  var html = '';
  DAYS.forEach(function(d){ html += '<div class="cal-dow">'+d.code+'</div>'; });

  var first = new Date(state.calYear, state.calMonth, 1);
  var startOffset = (first.getDay() + 6) % 7; // lunes primero
  var gridStart = new Date(state.calYear, state.calMonth, 1 - startOffset);
  var today = todayISO();

  var eventsByDate = {};
  state.events.forEach(function(ev){
    (eventsByDate[ev.fecha] = eventsByDate[ev.fecha] || []).push(ev);
  });

  for(var i=0;i<42;i++){
    var cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate()+i);
    var iso = cellDate.getFullYear()+'-'+String(cellDate.getMonth()+1).padStart(2,'0')+'-'+String(cellDate.getDate()).padStart(2,'0');
    var out = cellDate.getMonth() !== state.calMonth;
    var evs = eventsByDate[iso] || [];
    var cls = 'cal-cell'+(out?' out':'')+(iso===today?' today':'');
    html += '<div class="'+cls+'"><span class="n">'+cellDate.getDate()+'</span>';
    if(evs.length){
      html += '<div class="dot-wrap">'+evs.map(function(){return '<span class="ev-dot"></span>';}).join('')+'</div>';
    }
    html += '</div>';
  }
  grid.innerHTML = html;

  var listEl = document.getElementById('eventList');
  var upcoming = state.events.filter(function(e){ return e.fecha >= today; }).sort(function(a,b){ return a.fecha.localeCompare(b.fecha); }).slice(0,8);
  if(!upcoming.length){
    listEl.innerHTML = '<div class="empty">No hay próximas fechas. Añade la primera abajo.</div>';
  } else {
    listEl.innerHTML = '<div class="event-list">' + upcoming.map(function(ev){
      var d = new Date(ev.fecha+'T00:00:00');
      return '<div class="event-item">'
        + '<div class="event-date">'+d.getDate()+'<small>'+MESES_ABR[d.getMonth()]+'</small></div>'
        + '<div class="event-body"><div class="event-title">'+escapeHtml(ev.titulo)+'</div>'
        + (ev.descripcion ? '<div class="event-desc">'+escapeHtml(ev.descripcion)+'</div>' : '') + '</div>'
        + '<span class="chip event-type">'+TIPO_LABEL[ev.tipo]+'</span>'
        + '<button class="event-del" data-id="'+ev.id+'" title="Eliminar" aria-label="Eliminar fecha">×</button>'
        + '</div>';
    }).join('') + '</div>';
    listEl.querySelectorAll('.event-del').forEach(function(btn){
      btn.addEventListener('click', function(){
        if(db) deleteDoc(doc(eventsCol, btn.dataset.id));
      });
    });
  }
}

document.getElementById('calPrev').addEventListener('click', function(){
  state.calMonth--; if(state.calMonth<0){state.calMonth=11; state.calYear--;}
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', function(){
  state.calMonth++; if(state.calMonth>11){state.calMonth=0; state.calYear++;}
  renderCalendar();
});

document.getElementById('eventForm').addEventListener('submit', function(e){
  e.preventDefault();
  if(!db) return;
  var fecha = document.getElementById('evFecha').value;
  var tipo = document.getElementById('evTipo').value;
  var titulo = document.getElementById('evTitulo').value.trim();
  var descripcion = document.getElementById('evDesc').value.trim();
  if(!fecha || !titulo) return;
  addDoc(eventsCol, {fecha:fecha, tipo:tipo, titulo:titulo, descripcion:descripcion, creado:Date.now()});
  e.target.reset();
});

// ================= NIÑOS =================
function renderChildForm(){
  var editing = state.editingChildId;
  document.getElementById('childFormTitle').textContent = editing ? 'Editar niño o niña' : 'Añadir niño o niña';
  document.getElementById('chSubmitBtn').textContent = editing ? 'Guardar cambios' : 'Añadir';
  document.getElementById('chCancelBtn').style.display = editing ? 'inline-flex' : 'none';
}

document.getElementById('chCancelBtn').addEventListener('click', function(){
  state.editingChildId = null;
  document.getElementById('childForm').reset();
  renderChildForm();
});

document.getElementById('childForm').addEventListener('submit', function(e){
  e.preventDefault();
  if(!db) return;
  var nombre = document.getElementById('chNombre').value.trim();
  if(!nombre) return;
  var notas = document.getElementById('chNotas').value.trim();
  var dias = Array.prototype.slice.call(chDaysEl.querySelectorAll('input:checked')).map(function(i){return i.value;});

  if(state.editingChildId){
    updateDoc(doc(childrenCol, state.editingChildId), {nombre:nombre, notas:notas, dias:dias});
  } else {
    addDoc(childrenCol, {nombre:nombre, notas:notas, dias:dias, activo:true, creado:Date.now()});
  }
  state.editingChildId = null;
  e.target.reset();
  renderChildForm();
});

function startEditChild(child){
  state.editingChildId = child.id;
  document.getElementById('chNombre').value = child.nombre || '';
  document.getElementById('chNotas').value = child.notas || '';
  chDaysEl.querySelectorAll('input').forEach(function(i){
    i.checked = (child.dias||[]).indexOf(i.value) !== -1;
  });
  renderChildForm();
  document.getElementById('childForm').scrollIntoView({behavior:'smooth', block:'center'});
}

function renderChildList(){
  var el = document.getElementById('childList');
  if(!state.children.length){
    el.innerHTML = '<div class="empty">Todavía no hay niños registrados. Añade el primero arriba.</div>';
    return;
  }
  var sorted = state.children.slice().sort(function(a,b){
    if(!!a.activo !== !!b.activo) return a.activo ? -1 : 1;
    return (a.nombre||'').localeCompare(b.nombre||'', 'es');
  });
  el.innerHTML = sorted.map(function(c){
    var days = (c.dias||[]).length
      ? DAYS.filter(function(d){ return (c.dias||[]).indexOf(d.code)!==-1; }).map(function(d){ return '<span class="chip on">'+d.code+'</span>'; }).join('')
      : '<span class="chip">sin días fijos</span>';
    return '<div class="child-row'+(c.activo===false?' inactive':'')+'">'
      + '<div class="child-name">'+escapeHtml(c.nombre)+(c.notas?'<span class="sub">'+escapeHtml(c.notas)+'</span>':'')+'</div>'
      + '<div class="child-days">'+days+'</div>'
      + '<div class="child-actions">'
      + '<button class="btn ghost small" data-edit="'+c.id+'">Editar</button>'
      + '<button class="btn ghost small" data-toggle="'+c.id+'">'+(c.activo===false?'Reactivar':'Dar de baja')+'</button>'
      + '</div></div>';
  }).join('');

  el.querySelectorAll('[data-edit]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var c = state.children.find(function(x){return x.id===btn.dataset.edit;});
      if(c) startEditChild(c);
    });
  });
  el.querySelectorAll('[data-toggle]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(!db) return;
      var c = state.children.find(function(x){return x.id===btn.dataset.toggle;});
      if(c) updateDoc(doc(childrenCol, c.id), {activo: c.activo===false});
    });
  });
}

// ================= ASISTENCIA =================
document.getElementById('asisFecha').addEventListener('change', function(e){
  state.selectedDate = e.target.value || todayISO();
  renderAsistencia();
});

function attendanceFor(childId, fecha){
  return state.attendance.find(function(a){ return a.childId===childId && a.fecha===fecha; });
}

function setAttendance(childId, fecha, estado){
  if(!db) return;
  var current = attendanceFor(childId, fecha);
  var next = current && current.estado===estado ? null : estado;
  var id = childId+'__'+fecha;
  if(next===null){
    deleteDoc(doc(attendanceCol, id));
  } else {
    setDoc(doc(attendanceCol, id), {childId:childId, fecha:fecha, estado:next, anotado:Date.now()});
  }
}

function renderAsistencia(){
  document.getElementById('asisFecha').value = state.selectedDate;
  var dCode = weekdayCode(state.selectedDate);
  var dLabel = new Date(state.selectedDate+'T00:00:00').toLocaleDateString('es-ES',{weekday:'long', day:'numeric', month:'long'});
  document.getElementById('asisListTitle').textContent = dLabel.charAt(0).toUpperCase()+dLabel.slice(1);

  var active = state.children.filter(function(c){ return c.activo !== false; });
  var forDate = state.attendance.filter(function(a){ return a.fecha===state.selectedDate; });

  var counts = {asistio:0, falta:0, justificada:0};
  forDate.forEach(function(a){ if(counts[a.estado]!==undefined) counts[a.estado]++; });
  var sinRegistrar = active.length - forDate.length;

  document.getElementById('asisSummary').innerHTML = [
    ['Asistieron', counts.asistio, 'success'],
    ['Faltaron', counts.falta, 'danger'],
    ['Justificadas', counts.justificada, 'warning'],
    ['Sin registrar', Math.max(sinRegistrar,0), '']
  ].map(function(s){
    return '<div class="stat"><b style="'+(s[2]?'color:var(--'+s[2]+')':'')+'">'+s[1]+'</b><span>'+s[0]+'</span></div>';
  }).join('');

  var listEl = document.getElementById('asisList');
  if(!active.length){
    listEl.innerHTML = '<div class="empty">No hay niños activos todavía. Añádelos en la pestaña Niños.</div>';
    return;
  }
  var sorted = active.slice().sort(function(a,b){
    var aOn = (a.dias||[]).indexOf(dCode)!==-1, bOn = (b.dias||[]).indexOf(dCode)!==-1;
    if(aOn !== bOn) return aOn ? -1 : 1;
    return (a.nombre||'').localeCompare(b.nombre||'', 'es');
  });
  listEl.innerHTML = sorted.map(function(c){
    var rec = attendanceFor(c.id, state.selectedDate);
    var estado = rec ? rec.estado : null;
    var assigned = (c.dias||[]).indexOf(dCode)!==-1;
    return '<div class="child-row">'
      + '<div class="child-name">'+escapeHtml(c.nombre)+(assigned?'':'<span class="sub">no asignado hoy</span>')+'</div>'
      + '<div class="status-btns">'
      + '<button class="status-btn asistio'+(estado==='asistio'?' on':'')+'" data-child="'+c.id+'" data-estado="asistio">Asistió</button>'
      + '<button class="status-btn falta'+(estado==='falta'?' on':'')+'" data-child="'+c.id+'" data-estado="falta">Faltó</button>'
      + '<button class="status-btn justificada'+(estado==='justificada'?' on':'')+'" data-child="'+c.id+'" data-estado="justificada">Justificada</button>'
      + '</div></div>';
  }).join('');

  listEl.querySelectorAll('.status-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      setAttendance(btn.dataset.child, state.selectedDate, btn.dataset.estado);
    });
  });
}

// ================= BALANCE =================
function renderBalance(){
  var wrap = document.getElementById('balanceWrap');
  if(!state.children.length){
    wrap.innerHTML = '<div class="empty">Todavía no hay datos suficientes. Registra asistencia para ver el balance.</div>';
    return;
  }
  var rows = state.children.map(function(c){
    var recs = state.attendance.filter(function(a){ return a.childId===c.id; });
    var asistio = recs.filter(function(a){return a.estado==='asistio';}).length;
    var falta = recs.filter(function(a){return a.estado==='falta';}).length;
    var justificada = recs.filter(function(a){return a.estado==='justificada';}).length;
    var total = recs.length;
    var pct = total ? Math.round((asistio/total)*100) : null;
    return {c:c, asistio:asistio, falta:falta, justificada:justificada, total:total, pct:pct};
  }).sort(function(a,b){
    if(b.falta !== a.falta) return b.falta - a.falta;
    return (a.c.nombre||'').localeCompare(b.c.nombre||'', 'es');
  });

  var html = '<div class="table-wrap"><table><thead><tr>'
    + '<th>Niño/a</th><th>Días</th><th class="num">Sesiones</th><th class="num">Asistió</th>'
    + '<th class="num">Faltó</th><th class="num">Justif.</th><th>% Asistencia</th>'
    + '</tr></thead><tbody>';

  rows.forEach(function(r){
    var days = (r.c.dias||[]).length ? (r.c.dias||[]).join(' · ') : '—';
    var flag = r.pct!==null && r.pct<70;
    html += '<tr class="'+(flag?'row-flag':'')+'">'
      + '<td>'+escapeHtml(r.c.nombre)+(r.c.activo===false?' <span class="chip">baja</span>':'')+'</td>'
      + '<td>'+days+'</td>'
      + '<td class="num">'+r.total+'</td>'
      + '<td class="num">'+r.asistio+'</td>'
      + '<td class="num">'+r.falta+'</td>'
      + '<td class="num">'+r.justificada+'</td>'
      + '<td>' + (r.pct===null ? '<span style="color:var(--ink-dim);">—</span>' :
          '<div style="display:flex;align-items:center;gap:8px;"><div class="bar-track"><div class="bar-fill" style="width:'+r.pct+'%;background:'+(flag?'var(--danger)':'var(--success)')+';"></div></div><span class="num" style="min-width:34px;">'+r.pct+'%</span></div>')
        + '</td>'
      + '</tr>';
  });
  html += '</tbody></table></div>';
  wrap.innerHTML = html;
}

function renderAll(){
  renderCalendar();
  renderChildList();
  renderAsistencia();
  renderBalance();
}

// ================= FIREBASE WIRING =================
var statusEl = document.getElementById('connStatus');
function setStatus(text, cls){
  statusEl.innerHTML = '<span class="dot'+(cls?' '+cls:'')+'"></span><span>'+text+'</span>';
}

function showSetupBanner(){
  document.body.insertAdjacentHTML('afterbegin',
    '<div class="banner">Falta configurar Firebase: rellena <code>js/firebase-config.js</code> con los datos de tu proyecto para que esta página pueda guardar información.</div>');
  setStatus('Sin configurar', 'bad');
}

if(!firebaseConfig.apiKey || firebaseConfig.apiKey === 'TU_API_KEY'){
  showSetupBanner();
  renderAll();
} else {
  try{
    var app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    childrenCol = collection(db, 'children');
    eventsCol = collection(db, 'events');
    attendanceCol = collection(db, 'attendance');

    setStatus('Conectando…');

    onSnapshot(childrenCol, function(snap){
      state.children = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      renderChildList(); renderAsistencia(); renderBalance();
      setStatus('Conectado', 'ok');
    }, function(err){ setStatus('Error: '+err.message, 'bad'); });

    onSnapshot(eventsCol, function(snap){
      state.events = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      renderCalendar();
    }, function(err){ setStatus('Error: '+err.message, 'bad'); });

    onSnapshot(attendanceCol, function(snap){
      state.attendance = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      renderAsistencia(); renderBalance();
    }, function(err){ setStatus('Error: '+err.message, 'bad'); });

  } catch(err){
    setStatus('Error de configuración', 'bad');
    console.error(err);
  }
  renderAll();
}
