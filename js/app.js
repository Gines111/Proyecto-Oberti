import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

var ADMIN_EMAIL = 'ginespo2004@gmail.com';
var MONITOR_EMAIL = 'entrada@proyecto-oberti.app';

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
  editingChildId:null,
  editingEventId:null,
  isAdmin:false,
  isMonitor:false,
  childSearch:'',
  eventFilter:'todos',
  turnoFilter:'todos'
};

var db = null, auth = null;
var childrenCol, eventsCol, attendanceCol;

// ---------- mobile menu ----------
var menuBtn = document.getElementById('menuBtn');
var sidebarEl = document.getElementById('sidebar');
function closeMobileMenu(){
  sidebarEl.classList.remove('open');
  menuBtn.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', function(){
  var open = sidebarEl.classList.toggle('open');
  menuBtn.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('click', function(e){
  if(sidebarEl.classList.contains('open') && !sidebarEl.contains(e.target) && !menuBtn.contains(e.target)) closeMobileMenu();
});
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape') closeMobileMenu();
});

// ================= ADMIN LOGIN =================
var adminOpenBtn = document.getElementById('adminOpenBtn');
var adminLoginForm = document.getElementById('adminLoginForm');
var adminCancelBtn = document.getElementById('adminCancelBtn');
var adminActive = document.getElementById('adminActive');
var adminLogoutBtn = document.getElementById('adminLogoutBtn');
var adminLoginError = document.getElementById('adminLoginError');
var upgradeAdminBtn = document.getElementById('upgradeAdminBtn');

adminOpenBtn.addEventListener('click', function(){
  adminOpenBtn.hidden = true;
  adminLoginForm.hidden = false;
  document.getElementById('adminPassword').focus();
});
upgradeAdminBtn.addEventListener('click', function(){
  adminActive.hidden = true;
  adminLoginForm.hidden = false;
  document.getElementById('loginAsAdmin').checked = true;
  document.getElementById('adminPassword').focus();
});
adminCancelBtn.addEventListener('click', function(){
  adminLoginForm.hidden = true;
  adminLoginError.textContent = '';
  adminLoginForm.reset();
  if(state.isMonitor){
    adminActive.hidden = false;
  } else {
    adminOpenBtn.hidden = false;
  }
});
adminLoginForm.addEventListener('submit', function(e){
  e.preventDefault();
  if(!auth) return;
  var pass = document.getElementById('adminPassword').value;
  var asAdmin = document.getElementById('loginAsAdmin').checked;
  var email = asAdmin ? ADMIN_EMAIL : MONITOR_EMAIL;
  adminLoginError.textContent = '';
  signInWithEmailAndPassword(auth, email, pass).then(function(){
    adminLoginForm.reset();
    closeMobileMenu();
  }).catch(function(){
    adminLoginError.textContent = 'Contraseña incorrecta.';
  });
});
adminLogoutBtn.addEventListener('click', function(){
  if(auth) signOut(auth);
  closeMobileMenu();
});

function updateAuthUI(){
  var loggedIn = state.isMonitor;
  document.getElementById('mainContent').classList.toggle('locked', !loggedIn);
  document.getElementById('tabsNav').hidden = !loggedIn;
  document.getElementById('childFormCard').hidden = !state.isAdmin;
  document.getElementById('eventForm').hidden = !state.isAdmin;
  document.getElementById('importToggleBtn').hidden = !state.isAdmin;
  if(!state.isAdmin) document.getElementById('importCard').hidden = true;

  var adminOnlyTabWasActive = false;
  document.querySelectorAll('.tab-btn[data-admin-only]').forEach(function(btn){
    btn.hidden = !state.isAdmin;
    if(!state.isAdmin && btn.classList.contains('active')) adminOnlyTabWasActive = true;
  });
  if(adminOnlyTabWasActive){
    var calBtn = document.querySelector('.tab-btn[data-tab="calendario"]');
    document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.toggle('active', b===calBtn); });
    document.querySelectorAll('.panel').forEach(function(p){ p.classList.toggle('active', p.id==='panel-calendario'); });
  }
  if(loggedIn){
    adminOpenBtn.hidden = true;
    adminLoginForm.hidden = true;
    adminActive.hidden = false;
    upgradeAdminBtn.hidden = state.isAdmin;
    document.getElementById('roleChip').textContent = state.isAdmin ? 'Administrador' : 'Acceso';
  } else {
    adminActive.hidden = true;
    adminOpenBtn.hidden = false;
    adminLoginForm.hidden = true;
  }
}

// ---------- tabs ----------
document.querySelectorAll('.tab-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.tab-btn').forEach(function(b){b.classList.toggle('active', b===btn);});
    document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('active', p.id==='panel-'+btn.dataset.tab);});
    closeMobileMenu();
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
    var dow = cellDate.getDay();
    var cls = 'cal-cell'+(out?' out':'')+(iso===today?' today':'')+((dow===0||dow===6)?' weekend':'');
    if(state.isAdmin) cls += ' clickable';
    var tooltip = '';
    if(evs.length===1){
      cls += ' has-event tipo-'+evs[0].tipo;
      tooltip = evs[0].titulo + (evs[0].descripcion ? '\n'+evs[0].descripcion : '');
    } else if(evs.length>1){
      cls += ' has-event multi';
      tooltip = evs.map(function(ev){ return '• '+ev.titulo; }).join('\n');
    }
    html += '<div class="'+cls+'" data-date="'+iso+'"'+(tooltip?' data-tooltip="'+escapeHtml(tooltip)+'"':'')+'>'
      + '<span class="n">'+cellDate.getDate()+'</span>';
    if(evs.length>1){
      html += '<div class="dot-wrap">'+evs.map(function(ev){return '<span class="ev-dot tipo-'+ev.tipo+'"></span>';}).join('')+'</div>';
    }
    html += '</div>';
  }
  grid.innerHTML = html;

  var listEl = document.getElementById('eventList');
  var upcoming = state.events.filter(function(e){
    return e.fecha >= today && (state.eventFilter==='todos' || e.tipo===state.eventFilter);
  }).sort(function(a,b){ return a.fecha.localeCompare(b.fecha); }).slice(0,8);
  if(!upcoming.length){
    listEl.innerHTML = state.eventFilter==='todos'
      ? '<div class="empty">No hay próximas fechas. Añade la primera abajo.</div>'
      : '<div class="empty">No hay próximas fechas de tipo "'+TIPO_LABEL[state.eventFilter]+'".</div>';
  } else {
    listEl.innerHTML = '<div class="event-list">' + upcoming.map(function(ev){
      var d = new Date(ev.fecha+'T00:00:00');
      var isToday = ev.fecha === today;
      return '<div class="event-item'+(state.isAdmin?' clickable':'')+'" data-id="'+ev.id+'">'
        + '<div class="event-date'+(isToday?' is-today':'')+'">'+(isToday?'Hoy':d.getDate())+(isToday?'':'<small>'+MESES_ABR[d.getMonth()]+'</small>')+'</div>'
        + '<div class="event-body"><div class="event-title">'+escapeHtml(ev.titulo)+'</div>'
        + (ev.descripcion ? '<div class="event-desc">'+escapeHtml(ev.descripcion)+'</div>' : '') + '</div>'
        + '<span class="chip event-type tipo-'+ev.tipo+'">'+TIPO_LABEL[ev.tipo]+'</span>'
        + (state.isAdmin ? '<button class="event-del" data-id="'+ev.id+'" title="Eliminar" aria-label="Eliminar fecha">×</button>' : '')
        + '</div>';
    }).join('') + '</div>';
    listEl.querySelectorAll('.event-item').forEach(function(item){
      item.addEventListener('click', function(e){
        if(!state.isAdmin || e.target.closest('.event-del')) return;
        var ev = state.events.find(function(x){ return x.id===item.dataset.id; });
        if(ev) startEditEvent(ev);
      });
    });
    listEl.querySelectorAll('.event-del').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        if(!db || !state.isAdmin) return;
        var ev = state.events.find(function(x){ return x.id===btn.dataset.id; });
        var nombre = ev ? ev.titulo : 'esta fecha';
        if(confirm('¿Eliminar "'+nombre+'"? No se puede deshacer.')){
          deleteDoc(doc(eventsCol, btn.dataset.id));
        }
      });
    });
  }
}

document.querySelectorAll('#evFilter .ev-filter-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    state.eventFilter = btn.dataset.filtro;
    document.querySelectorAll('#evFilter .ev-filter-btn').forEach(function(b){ b.classList.toggle('active', b===btn); });
    renderCalendar();
  });
});

document.getElementById('calPrev').addEventListener('click', function(){
  state.calMonth--; if(state.calMonth<0){state.calMonth=11; state.calYear--;}
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', function(){
  state.calMonth++; if(state.calMonth>11){state.calMonth=0; state.calYear++;}
  renderCalendar();
});

function renderEventForm(){
  var editing = state.editingEventId;
  document.getElementById('eventFormTitle').textContent = editing ? 'Editar fecha' : 'Añadir fecha';
  document.getElementById('evSubmitBtn').textContent = editing ? 'Guardar cambios' : 'Añadir fecha';
  document.getElementById('evCancelBtn').hidden = !editing;
}

function startNewEvent(fecha){
  state.editingEventId = null;
  document.getElementById('eventForm').reset();
  document.getElementById('evFecha').value = fecha;
  renderEventForm();
  document.getElementById('eventForm').scrollIntoView({behavior:'smooth', block:'center'});
  document.getElementById('evTitulo').focus();
}

function startEditEvent(ev){
  state.editingEventId = ev.id;
  document.getElementById('evFecha').value = ev.fecha;
  document.getElementById('evTipo').value = ev.tipo;
  document.getElementById('evTitulo').value = ev.titulo || '';
  document.getElementById('evDesc').value = ev.descripcion || '';
  renderEventForm();
  document.getElementById('eventForm').scrollIntoView({behavior:'smooth', block:'center'});
  document.getElementById('evTitulo').focus();
}

document.getElementById('calGrid').addEventListener('click', function(e){
  if(!state.isAdmin) return;
  var cell = e.target.closest('.cal-cell');
  if(!cell || !cell.dataset.date) return;
  var evs = state.events.filter(function(ev){ return ev.fecha===cell.dataset.date; });
  if(evs.length){
    startEditEvent(evs[0]);
  } else {
    startNewEvent(cell.dataset.date);
  }
});

document.getElementById('evCancelBtn').addEventListener('click', function(){
  state.editingEventId = null;
  document.getElementById('eventForm').reset();
  renderEventForm();
});

document.getElementById('eventForm').addEventListener('submit', function(e){
  e.preventDefault();
  if(!db || !state.isAdmin) return;
  var fecha = document.getElementById('evFecha').value;
  var tipo = document.getElementById('evTipo').value;
  var titulo = document.getElementById('evTitulo').value.trim();
  var descripcion = document.getElementById('evDesc').value.trim();
  if(!fecha || !titulo) return;
  if(state.editingEventId){
    updateDoc(doc(eventsCol, state.editingEventId), {fecha:fecha, tipo:tipo, titulo:titulo, descripcion:descripcion});
  } else {
    addDoc(eventsCol, {fecha:fecha, tipo:tipo, titulo:titulo, descripcion:descripcion, creado:Date.now()});
  }
  state.editingEventId = null;
  e.target.reset();
  renderEventForm();
});

// ================= NIÑOS =================
function renderChildForm(){
  var editing = state.editingChildId;
  document.getElementById('childFormTitle').textContent = editing ? 'Editar niño o niña' : 'Añadir niño o niña';
  document.getElementById('chSubmitBtn').textContent = editing ? 'Guardar cambios' : 'Añadir';
  document.getElementById('chCancelBtn').style.display = editing ? 'inline-flex' : 'none';
}

document.getElementById('childSearch').addEventListener('input', function(e){
  state.childSearch = e.target.value;
  renderChildList();
});

document.getElementById('chCancelBtn').addEventListener('click', function(){
  state.editingChildId = null;
  document.getElementById('childForm').reset();
  renderChildForm();
});

document.getElementById('childForm').addEventListener('submit', function(e){
  e.preventDefault();
  if(!db || !state.isAdmin) return;
  var nombre = document.getElementById('chNombre').value.trim();
  if(!nombre) return;
  var notas = document.getElementById('chNotas').value.trim();
  var curso = document.getElementById('chCurso').value.trim();
  var colegio = document.getElementById('chColegio').value.trim();
  var turno = document.getElementById('chTurno').value;
  var extraescolares = document.getElementById('chExtraescolares').value.trim();
  var dias = Array.prototype.slice.call(chDaysEl.querySelectorAll('input:checked')).map(function(i){return i.value;});

  if(state.editingChildId){
    updateDoc(doc(childrenCol, state.editingChildId), {nombre:nombre, notas:notas, dias:dias, curso:curso, colegio:colegio, turno:turno, extraescolares:extraescolares});
  } else {
    addDoc(childrenCol, {nombre:nombre, notas:notas, dias:dias, curso:curso, colegio:colegio, turno:turno, extraescolares:extraescolares, activo:true, creado:Date.now()});
  }
  state.editingChildId = null;
  e.target.reset();
  renderChildForm();
});

function startEditChild(child){
  state.editingChildId = child.id;
  document.getElementById('chNombre').value = child.nombre || '';
  document.getElementById('chNotas').value = child.notas || '';
  document.getElementById('chCurso').value = child.curso || '';
  document.getElementById('chColegio').value = child.colegio || '';
  document.getElementById('chTurno').value = child.turno || '';
  document.getElementById('chExtraescolares').value = child.extraescolares || '';
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
  var q = state.childSearch.trim().toLowerCase();
  var filtered = q
    ? state.children.filter(function(c){ return (c.nombre||'').toLowerCase().indexOf(q)!==-1; })
    : state.children;
  if(!filtered.length){
    el.innerHTML = '<div class="empty">Ningún niño coincide con "'+escapeHtml(state.childSearch.trim())+'".</div>';
    return;
  }
  var sorted = filtered.slice().sort(function(a,b){
    if(!!a.activo !== !!b.activo) return a.activo ? -1 : 1;
    return (a.nombre||'').localeCompare(b.nombre||'', 'es');
  });
  el.innerHTML = sorted.map(function(c){
    var days = (c.dias||[]).length
      ? DAYS.filter(function(d){ return (c.dias||[]).indexOf(d.code)!==-1; }).map(function(d){ return '<span class="chip on">'+d.code+'</span>'; }).join('')
      : '<span class="chip">sin días fijos</span>';
    var meta = [c.curso, c.colegio, c.turno].filter(Boolean).join(' · ');
    return '<div class="child-row'+(c.activo===false?' inactive':'')+'">'
      + '<div class="child-name">'+escapeHtml(c.nombre)
        + (meta?'<span class="sub">'+escapeHtml(meta)+'</span>':'')
        + (c.extraescolares?'<span class="sub">Extraescolares: '+escapeHtml(c.extraescolares)+'</span>':'')
        + (c.notas?'<span class="sub">'+escapeHtml(c.notas)+'</span>':'')
        + '</div>'
      + '<div class="child-days">'+days+'</div>'
      + (state.isAdmin ? '<div class="child-actions">'
        + '<button class="btn ghost small" data-edit="'+c.id+'">Editar</button>'
        + '<button class="btn ghost small" data-toggle="'+c.id+'">'+(c.activo===false?'Reactivar':'Dar de baja')+'</button>'
        + '</div>' : '')
      + '</div>';
  }).join('');

  el.querySelectorAll('[data-edit]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var c = state.children.find(function(x){return x.id===btn.dataset.edit;});
      if(c) startEditChild(c);
    });
  });
  el.querySelectorAll('[data-toggle]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(!db || !state.isAdmin) return;
      var c = state.children.find(function(x){return x.id===btn.dataset.toggle;});
      if(!c) return;
      var reactivando = c.activo===false;
      if(reactivando || confirm('¿Dar de baja a '+c.nombre+'? Podrás reactivarlo/a cuando quieras; su historial de asistencia se conserva.')){
        updateDoc(doc(childrenCol, c.id), {activo: reactivando});
      }
    });
  });
}

// ---------- importar varios por texto ----------
document.getElementById('importToggleBtn').addEventListener('click', function(){
  var card = document.getElementById('importCard');
  card.hidden = !card.hidden;
  if(!card.hidden) document.getElementById('importText').focus();
});

function parseImportText(text){
  return text.split('\n').map(function(line){ return line.trim(); })
    .filter(function(line){ return line.indexOf('/') !== -1; })
    .map(function(line){
      var parts = line.split('/').map(function(p){ return p.trim(); });
      return {nombre: parts[0]||'', curso: parts[1]||'', colegio: parts[2]||'', turno: parts[3]||''};
    })
    .filter(function(row){ return row.nombre; });
}

document.getElementById('importParseBtn').addEventListener('click', function(){
  var rows = parseImportText(document.getElementById('importText').value);
  var previewEl = document.getElementById('importPreview');
  if(!rows.length){
    previewEl.hidden = false;
    previewEl.innerHTML = '<div class="empty">No se ha detectado ningún niño. Revisa que cada línea tenga el formato Nombre / Curso / Colegio / Turno.</div>';
    return;
  }
  var existingNames = state.children.map(function(c){ return (c.nombre||'').trim().toLowerCase(); });
  previewEl.hidden = false;
  previewEl.innerHTML = '<p class="panel-sub" style="margin:12px 0 8px;">Revisa y corrige si algo no se ha detectado bien antes de importar:</p>'
    + '<div class="import-rows">' + rows.map(function(r, i){
      var dup = existingNames.indexOf(r.nombre.trim().toLowerCase()) !== -1;
      return '<div class="import-row">'
        + '<label class="import-check"><input type="checkbox" data-i="'+i+'" '+(dup?'':'checked')+'></label>'
        + '<input type="text" data-i="'+i+'" data-f="nombre" value="'+escapeHtml(r.nombre)+'" placeholder="Nombre">'
        + '<input type="text" data-i="'+i+'" data-f="curso" value="'+escapeHtml(r.curso)+'" placeholder="Curso">'
        + '<input type="text" data-i="'+i+'" data-f="colegio" value="'+escapeHtml(r.colegio)+'" placeholder="Colegio">'
        + '<input type="text" data-i="'+i+'" data-f="turno" value="'+escapeHtml(r.turno)+'" placeholder="Turno">'
        + (dup ? '<span class="chip">ya existe</span>' : '<span></span>')
        + '</div>';
    }).join('') + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:12px;">'
    + '<button class="btn" type="button" id="importConfirmBtn">Importar</button>'
    + '<button class="btn ghost" type="button" id="importCancelBtn">Cancelar</button>'
    + '</div>';

  previewEl.querySelectorAll('input[type=text]').forEach(function(inp){
    inp.addEventListener('input', function(){
      rows[+inp.dataset.i][inp.dataset.f] = inp.value;
    });
  });
  document.getElementById('importCancelBtn').addEventListener('click', function(){
    previewEl.hidden = true;
    previewEl.innerHTML = '';
    document.getElementById('importText').value = '';
  });
  document.getElementById('importConfirmBtn').addEventListener('click', function(){
    if(!db || !state.isAdmin) return;
    var checks = previewEl.querySelectorAll('input[type=checkbox]');
    var toImport = [];
    checks.forEach(function(chk){
      if(chk.checked) toImport.push(rows[+chk.dataset.i]);
    });
    if(!toImport.length) return;
    toImport.forEach(function(r){
      if(!r.nombre.trim()) return;
      addDoc(childrenCol, {
        nombre:r.nombre.trim(), curso:r.curso.trim(), colegio:r.colegio.trim(), turno:r.turno.trim(),
        dias:[], notas:'', extraescolares:'', activo:true, creado:Date.now()
      });
    });
    previewEl.hidden = true;
    previewEl.innerHTML = '';
    document.getElementById('importText').value = '';
    document.getElementById('importCard').hidden = true;
  });
});

// ================= ASISTENCIA =================
document.getElementById('asisFecha').addEventListener('change', function(e){
  state.selectedDate = e.target.value || todayISO();
  renderAsistencia();
});

document.querySelectorAll('#turnoFilter .ev-filter-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    state.turnoFilter = btn.dataset.turno;
    document.querySelectorAll('#turnoFilter .ev-filter-btn').forEach(function(b){ b.classList.toggle('active', b===btn); });
    renderAsistencia();
  });
});

function matchesTurno(child){
  if(state.turnoFilter==='todos') return true;
  if(child.turno===state.turnoFilter) return true;
  if((state.turnoFilter==='Turno 1' || state.turnoFilter==='Turno 2') && child.turno==='Ambos turnos') return true;
  return false;
}

function attendanceFor(childId, fecha){
  return state.attendance.find(function(a){ return a.childId===childId && a.fecha===fecha; });
}

function setAttendance(childId, fecha, estado){
  if(!db) return;
  if(estado==='justificada' && !state.isAdmin) return;
  var current = attendanceFor(childId, fecha);
  var next = current && current.estado===estado ? null : estado;
  var id = childId+'__'+fecha;
  if(next===null){
    deleteDoc(doc(attendanceCol, id)).catch(function(){});
  } else {
    setDoc(doc(attendanceCol, id), {childId:childId, fecha:fecha, estado:next, anotado:Date.now()}).catch(function(){});
  }
}

function renderAsistencia(){
  document.getElementById('asisFecha').value = state.selectedDate;
  var dCode = weekdayCode(state.selectedDate);
  var dLabel = new Date(state.selectedDate+'T00:00:00').toLocaleDateString('es-ES',{weekday:'long', day:'numeric', month:'long'});
  document.getElementById('asisListTitle').textContent = dLabel.charAt(0).toUpperCase()+dLabel.slice(1);

  var active = state.children.filter(function(c){ return c.activo !== false; });
  var filtered = active.filter(matchesTurno);
  var filteredIds = filtered.map(function(c){ return c.id; });
  var forDate = state.attendance.filter(function(a){ return a.fecha===state.selectedDate && filteredIds.indexOf(a.childId)!==-1; });

  var counts = {asistio:0, tarde:0, falta:0, justificada:0};
  forDate.forEach(function(a){ if(counts[a.estado]!==undefined) counts[a.estado]++; });
  var sinRegistrar = filtered.length - forDate.length;

  document.getElementById('asisSummary').innerHTML = [
    ['Asistieron', counts.asistio, 'success'],
    ['Tarde', counts.tarde, 'brand-coral'],
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
  if(!filtered.length){
    listEl.innerHTML = '<div class="empty">Ningún niño activo tiene el turno "'+escapeHtml(state.turnoFilter)+'".</div>';
    return;
  }
  var sorted = filtered.slice().sort(function(a,b){
    var aOn = (a.dias||[]).indexOf(dCode)!==-1, bOn = (b.dias||[]).indexOf(dCode)!==-1;
    if(aOn !== bOn) return aOn ? -1 : 1;
    return (a.nombre||'').localeCompare(b.nombre||'', 'es');
  });
  listEl.innerHTML = sorted.map(function(c){
    var rec = attendanceFor(c.id, state.selectedDate);
    var estado = rec ? rec.estado : null;
    var assigned = (c.dias||[]).indexOf(dCode)!==-1;
    var statusHtml = '<div class="status-btns">'
      + '<button class="status-btn asistio'+(estado==='asistio'?' on':'')+'" data-child="'+c.id+'" data-estado="asistio">Asistió</button>'
      + '<button class="status-btn tarde'+(estado==='tarde'?' on':'')+'" data-child="'+c.id+'" data-estado="tarde">Tarde</button>'
      + '<button class="status-btn falta'+(estado==='falta'?' on':'')+'" data-child="'+c.id+'" data-estado="falta">Faltó</button>'
      + (state.isAdmin
          ? '<button class="status-btn justificada'+(estado==='justificada'?' on':'')+'" data-child="'+c.id+'" data-estado="justificada">Justificada</button>'
          : (estado==='justificada' ? '<span class="status-chip justificada">Justificada</span>' : ''))
      + '</div>';
    return '<div class="child-row">'
      + '<div class="child-name">'+escapeHtml(c.nombre)+(assigned?'':'<span class="sub">no asignado hoy</span>')+'</div>'
      + statusHtml + '</div>';
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
    var tarde = recs.filter(function(a){return a.estado==='tarde';}).length;
    var falta = recs.filter(function(a){return a.estado==='falta';}).length;
    var justificada = recs.filter(function(a){return a.estado==='justificada';}).length;
    var total = recs.length;
    var pct = total ? Math.round(((asistio+tarde)/total)*100) : null;
    return {c:c, asistio:asistio, tarde:tarde, falta:falta, justificada:justificada, total:total, pct:pct};
  }).sort(function(a,b){
    if(b.falta !== a.falta) return b.falta - a.falta;
    return (a.c.nombre||'').localeCompare(b.c.nombre||'', 'es');
  });

  var html = '<div class="table-wrap"><table><thead><tr>'
    + '<th>Niño/a</th><th>Días</th><th class="num">Sesiones</th><th class="num">Asistió</th>'
    + '<th class="num">Tarde</th><th class="num">Faltó</th><th class="num">Justif.</th><th>% Asistencia</th>'
    + '</tr></thead><tbody>';

  rows.forEach(function(r){
    var days = (r.c.dias||[]).length ? (r.c.dias||[]).join(' · ') : '—';
    var flag = r.pct!==null && r.pct<70;
    html += '<tr class="'+(flag?'row-flag':'')+'">'
      + '<td>'+escapeHtml(r.c.nombre)+(r.c.activo===false?' <span class="chip">baja</span>':'')+'</td>'
      + '<td>'+days+'</td>'
      + '<td class="num">'+r.total+'</td>'
      + '<td class="num">'+r.asistio+'</td>'
      + '<td class="num">'+r.tarde+'</td>'
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
    auth = getAuth(app);
    childrenCol = collection(db, 'children');
    eventsCol = collection(db, 'events');
    attendanceCol = collection(db, 'attendance');

    setStatus('Conectando…');

    onAuthStateChanged(auth, function(user){
      state.isAdmin = !!user && user.email === ADMIN_EMAIL;
      state.isMonitor = !!user;
      updateAuthUI();
      renderAll();
    });

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
