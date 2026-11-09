import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc, deleteField, onSnapshot, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

var DEFAULT_EMAIL_DOMAIN = '@proyecto-oberti.app';
function normalizeLoginId(v){
  v = (v||'').trim().toLowerCase();
  if(!v || v.indexOf('@') !== -1) return v;
  return v + DEFAULT_EMAIL_DOMAIN;
}

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
  editingUserEmail:null,
  isAdmin:false,
  isMonitor:false,
  currentEmail:null,
  perms:{ninos:false, balance:false, calendarioEditar:false, justificar:false, ordenadores:false},
  roles:[],
  ordenadores:{},
  pcTurno:'Turno 1',
  childSearch:'',
  asisSearch:'',
  userSearch:'',
  balanceSearch:'',
  eventFilter:'todos',
  turnoFilter:'todos',
  calSel:null,
  forceList:{},
  periodo:'todo',
  detailChild:null
};
function isoOf(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function longDate(iso){ return new Date(iso+'T00:00:00').toLocaleDateString('es-ES',{weekday:'long', day:'numeric', month:'long'}); }
function shortDate(iso){ var d = new Date(iso+'T00:00:00'); return d.getDate()+' '+MESES_ABR[d.getMonth()]; }
function festivoOn(iso){ return state.events.find(function(e){ return e.fecha===iso && e.tipo==='festivo'; }); }
function defaultPerms(){ return {ninos:false, balance:false, calendarioEditar:false, justificar:false, ordenadores:false}; }
function can(p){ return state.isAdmin || !!(state.perms && state.perms[p]); }

var db = null, auth = null;
var childrenCol, eventsCol, attendanceCol, rolesCol, loginsCol, ordenadoresCol;
var unsubRoles = null;
function attachRolesListener(){
  if(unsubRoles || !db) return;
  unsubRoles = onSnapshot(rolesCol, function(snap){
    state.roles = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderUserList();
  }, function(err){ console.error(err); });
}
function detachRolesListener(){
  if(unsubRoles){ unsubRoles(); unsubRoles = null; }
  state.roles = [];
}

var unsubOrdenadores = null;
function attachOrdenadoresListener(){
  if(unsubOrdenadores || !db) return;
  unsubOrdenadores = onSnapshot(ordenadoresCol, function(snap){
    var obj = {};
    snap.docs.forEach(function(d){ obj[d.id] = d.data(); });
    state.ordenadores = obj;
    renderOrdenadores();
  }, function(err){ console.error(err); });
}
function detachOrdenadoresListener(){
  if(unsubOrdenadores){ unsubOrdenadores(); unsubOrdenadores = null; }
  state.ordenadores = {};
}

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

adminOpenBtn.addEventListener('click', function(){
  adminOpenBtn.hidden = true;
  adminLoginForm.hidden = false;
  document.getElementById('loginEmail').focus();
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
  var email = normalizeLoginId(document.getElementById('loginEmail').value);
  var pass = document.getElementById('adminPassword').value;
  adminLoginError.textContent = '';
  signInWithEmailAndPassword(auth, email, pass).then(function(cred){
    adminLoginForm.reset();
    closeMobileMenu();
    if(loginsCol) addDoc(loginsCol, {email: cred.user.email, fecha: Date.now()}).catch(function(){});
  }).catch(function(){
    adminLoginError.textContent = 'Email o contraseña incorrectos.';
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
  document.getElementById('childFormCard').hidden = !can('ninos');
  document.getElementById('chNotasField').hidden = !state.isAdmin;
  document.getElementById('eventForm').hidden = !can('calendarioEditar');
  document.getElementById('importToggleBtn').hidden = !can('ninos');
  if(!can('ninos')) document.getElementById('importCard').hidden = true;
  document.getElementById('backupBtn').hidden = !can('balance');

  var adminOnlyTabWasActive = false;
  document.querySelectorAll('.tab-btn[data-admin-only]').forEach(function(btn){
    btn.hidden = !state.isAdmin;
    if(!state.isAdmin && btn.classList.contains('active')) adminOnlyTabWasActive = true;
  });
  document.querySelectorAll('.tab-btn[data-perm]').forEach(function(btn){
    var allowed = can(btn.dataset.perm);
    btn.hidden = !allowed;
    if(!allowed && btn.classList.contains('active')) adminOnlyTabWasActive = true;
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
    document.getElementById('roleChip').textContent = (state.isAdmin ? 'Administrador/a' : 'Monitor/a') + (state.currentEmail ? ' · '+state.currentEmail : '');
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
document.getElementById('pcFecha').value = state.selectedDate;

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
    var cls = 'cal-cell'+(out?' out':'')+(iso===today?' today':'')+((dow===0||dow===6)?' weekend':'')+(iso===state.calSel?' selected':'');
    if(state.isMonitor) cls += ' clickable';
    var tooltip = '';
    if(evs.length===1){
      cls += ' has-event tipo-'+evs[0].tipo;
      tooltip = evs[0].titulo + (evs[0].descripcion ? '\n'+evs[0].descripcion : '');
    } else if(evs.length>1){
      cls += ' has-event multi';
      tooltip = evs.map(function(ev){ return '• '+ev.titulo; }).join('\n');
    }
    html += '<div class="'+cls+'" data-date="'+iso+'"'+(tooltip?' data-tooltip="'+escapeHtml(tooltip)+'"':'')
      + (state.isMonitor?' role="button" tabindex="0" aria-label="'+escapeHtml(longDate(iso)+(evs.length?', '+evs.length+' fecha'+(evs.length>1?'s':''):''))+'"':'')+'>'
      + '<span class="n">'+cellDate.getDate()+'</span>';
    if(evs.length>1){
      html += '<div class="dot-wrap">'+evs.map(function(ev){return '<span class="ev-dot tipo-'+ev.tipo+'"></span>';}).join('')+'</div>';
    }
    html += '</div>';
  }
  grid.innerHTML = html;
  renderDayBox();

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
      return '<div class="event-item'+(can('calendarioEditar')?' clickable':'')+'" data-id="'+ev.id+'">'
        + '<div class="event-date'+(isToday?' is-today':'')+'">'+(isToday?'Hoy':d.getDate())+(isToday?'':'<small>'+MESES_ABR[d.getMonth()]+'</small>')+'</div>'
        + '<div class="event-body"><div class="event-title">'+escapeHtml(ev.titulo)+'</div>'
        + (ev.descripcion ? '<div class="event-desc">'+escapeHtml(ev.descripcion)+'</div>' : '') + '</div>'
        + '<span class="chip event-type tipo-'+ev.tipo+'">'+TIPO_LABEL[ev.tipo]+'</span>'
        + (can('calendarioEditar') ? '<button class="event-del" data-id="'+ev.id+'" title="Eliminar" aria-label="Eliminar fecha">×</button>' : '')
        + '</div>';
    }).join('') + '</div>';
    listEl.querySelectorAll('.event-item').forEach(function(item){
      item.addEventListener('click', function(e){
        if(!can('calendarioEditar') || e.target.closest('.event-del')) return;
        var ev = state.events.find(function(x){ return x.id===item.dataset.id; });
        if(ev) startEditEvent(ev);
      });
    });
    listEl.querySelectorAll('.event-del').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        if(!db || !can('calendarioEditar')) return;
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

// ---- Día seleccionado: ver sus fechas, pasar lista o añadir ----
function renderDayBox(){
  var box = document.getElementById('dayBox');
  if(!state.calSel || !state.isMonitor){ box.hidden = true; return; }
  box.hidden = false;
  document.getElementById('dayBoxTitle').textContent = longDate(state.calSel);
  var evs = state.events.filter(function(ev){ return ev.fecha===state.calSel; });
  var editable = can('calendarioEditar');
  document.getElementById('dayBoxEvents').innerHTML = evs.length
    ? evs.map(function(ev){
        return '<div class="day-ev"><span class="chip event-type tipo-'+ev.tipo+'">'+TIPO_LABEL[ev.tipo]+'</span>'
          + '<span class="event-title">'+escapeHtml(ev.titulo)+'</span>'
          + (editable ? '<button class="btn ghost small" type="button" data-day-edit="'+ev.id+'">Editar</button>' : '')
          + '</div>';
      }).join('')
    : '<div class="panel-sub">Nada apuntado este día.</div>';
  document.getElementById('dayBoxAdd').hidden = !editable;
  document.querySelectorAll('[data-day-edit]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var ev = state.events.find(function(x){ return x.id===btn.dataset.dayEdit; });
      if(ev) startEditEvent(ev);
    });
  });
}

function selectCalDay(iso){
  state.calSel = state.calSel===iso ? null : iso;
  renderCalendar();
  if(state.calSel && can('calendarioEditar') && !state.editingEventId) document.getElementById('evFecha').value = iso;
}

document.getElementById('calGrid').addEventListener('click', function(e){
  if(!state.isMonitor) return;
  var cell = e.target.closest('.cal-cell');
  if(!cell || !cell.dataset.date) return;
  selectCalDay(cell.dataset.date);
});
document.getElementById('calGrid').addEventListener('keydown', function(e){
  if(e.key!=='Enter' && e.key!==' ') return;
  var cell = e.target.closest('.cal-cell');
  if(!cell || !state.isMonitor) return;
  e.preventDefault();
  selectCalDay(cell.dataset.date);
});
document.getElementById('dayBoxClose').addEventListener('click', function(){ state.calSel = null; renderCalendar(); });
document.getElementById('dayBoxAdd').addEventListener('click', function(){ if(state.calSel) startNewEvent(state.calSel); });
document.getElementById('dayBoxAsis').addEventListener('click', function(){
  if(!state.calSel) return;
  state.selectedDate = state.calSel;
  document.getElementById('pcFecha').value = state.selectedDate;
  renderAsistencia();
  renderOrdenadores();
  var btn = document.querySelector('.tab-btn[data-tab="asistencia"]');
  if(btn) btn.click();
});

document.getElementById('evCancelBtn').addEventListener('click', function(){
  state.editingEventId = null;
  document.getElementById('eventForm').reset();
  renderEventForm();
});

document.getElementById('eventForm').addEventListener('submit', function(e){
  e.preventDefault();
  if(!db || !can('calendarioEditar')) return;
  var fecha = document.getElementById('evFecha').value;
  var tipo = document.getElementById('evTipo').value;
  var titulo = document.getElementById('evTitulo').value.trim();
  var descripcion = document.getElementById('evDesc').value.trim();
  if(!fecha || !titulo) return;
  if(state.editingEventId){
    updateDoc(doc(eventsCol, state.editingEventId), {fecha:fecha, tipo:tipo, titulo:titulo, descripcion:descripcion, modificadoPor:state.currentEmail, modificado:Date.now()});
  } else {
    addDoc(eventsCol, {fecha:fecha, tipo:tipo, titulo:titulo, descripcion:descripcion, creado:Date.now(), creadoPor:state.currentEmail});
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
document.getElementById('asisSearch').addEventListener('input', function(e){
  state.asisSearch = e.target.value;
  renderAsistencia();
});
document.getElementById('userSearch').addEventListener('input', function(e){
  state.userSearch = e.target.value;
  renderUserList();
});
document.getElementById('balanceSearch').addEventListener('input', function(e){
  state.balanceSearch = e.target.value;
  renderBalance();
});

document.getElementById('chCancelBtn').addEventListener('click', function(){
  state.editingChildId = null;
  document.getElementById('childForm').reset();
  renderChildForm();
});

document.getElementById('childForm').addEventListener('submit', function(e){
  e.preventDefault();
  if(!db || !can('ninos')) return;
  var nombre = document.getElementById('chNombre').value.trim();
  if(!nombre) return;
  var notas = document.getElementById('chNotas').value.trim();
  var privado = {
    notas:notas,
    contacto:document.getElementById('chContacto').value.trim(),
    telefono:document.getElementById('chTelefono').value.trim(),
    modificadoPor:state.currentEmail, modificado:Date.now()
  };
  var hayPrivado = !!(privado.notas || privado.contacto || privado.telefono);
  var curso = document.getElementById('chCurso').value.trim();
  var colegio = document.getElementById('chColegio').value.trim();
  var turno = document.getElementById('chTurno').value;
  var extraescolares = document.getElementById('chExtraescolares').value.trim();
  var dias = Array.prototype.slice.call(chDaysEl.querySelectorAll('input:checked')).map(function(i){return i.value;});

  if(state.editingChildId){
    var childId = state.editingChildId;
    updateDoc(doc(childrenCol, childId), {nombre:nombre, dias:dias, curso:curso, colegio:colegio, turno:turno, extraescolares:extraescolares, modificadoPor:state.currentEmail, modificado:Date.now()});
    if(state.isAdmin) setDoc(doc(childrenCol, childId, 'private', 'info'), privado);
  } else {
    addDoc(childrenCol, {nombre:nombre, dias:dias, curso:curso, colegio:colegio, turno:turno, extraescolares:extraescolares, activo:true, creado:Date.now(), creadoPor:state.currentEmail}).then(function(ref){
      if(state.isAdmin && hayPrivado) setDoc(doc(ref, 'private', 'info'), privado);
    });
  }
  state.editingChildId = null;
  e.target.reset();
  renderChildForm();
});

function startEditChild(child){
  state.editingChildId = child.id;
  document.getElementById('chNombre').value = child.nombre || '';
  document.getElementById('chNotas').value = '';
  document.getElementById('chContacto').value = '';
  document.getElementById('chTelefono').value = '';
  document.getElementById('chCurso').value = child.curso || '';
  document.getElementById('chColegio').value = child.colegio || '';
  document.getElementById('chTurno').value = child.turno || '';
  document.getElementById('chExtraescolares').value = child.extraescolares || '';
  chDaysEl.querySelectorAll('input').forEach(function(i){
    i.checked = (child.dias||[]).indexOf(i.value) !== -1;
  });
  renderChildForm();
  document.getElementById('childForm').scrollIntoView({behavior:'smooth', block:'center'});
  if(db && state.isAdmin){
    getDoc(doc(childrenCol, child.id, 'private', 'info')).then(function(snap){
      if(state.editingChildId!==child.id) return;
      var p = snap.exists() ? snap.data() : {};
      document.getElementById('chNotas').value = p.notas || '';
      document.getElementById('chContacto').value = p.contacto || '';
      document.getElementById('chTelefono').value = p.telefono || '';
    }).catch(function(){});
  }
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
        + '</div>'
      + '<div class="child-days">'+days+'</div>'
      + (can('ninos') ? '<div class="child-actions">'
        + '<button class="btn ghost small" data-edit="'+c.id+'">Editar</button>'
        + '<button class="btn ghost small" data-toggle="'+c.id+'">'+(c.activo===false?'Reactivar':'Dar de baja')+'</button>'
        + (state.isAdmin ? '<button class="btn danger-ghost small" data-delete-child="'+c.id+'">Borrar</button>' : '')
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
      if(!db || !can('ninos')) return;
      var c = state.children.find(function(x){return x.id===btn.dataset.toggle;});
      if(!c) return;
      var reactivando = c.activo===false;
      if(reactivando || confirm('¿Dar de baja a '+c.nombre+'? Podrás reactivarlo/a cuando quieras; su historial de asistencia se conserva.')){
        updateDoc(doc(childrenCol, c.id), {activo: reactivando, modificadoPor:state.currentEmail, modificado:Date.now()});
      }
    });
  });
  el.querySelectorAll('[data-delete-child]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(!db || !state.isAdmin) return;
      var c = state.children.find(function(x){return x.id===btn.dataset.deleteChild;});
      if(!c) return;
      var recs = state.attendance.filter(function(a){ return a.childId===c.id; });
      if(!confirm('¿Borrar del todo a '+c.nombre+'? Se eliminarán su ficha, sus notas privadas y sus '+recs.length+' registros de asistencia. No se puede deshacer.\n\nSi solo ha dejado de venir, mejor usa "Dar de baja".')) return;
      if(state.editingChildId===c.id){ state.editingChildId = null; document.getElementById('childForm').reset(); renderChildForm(); }
      Promise.all(recs.map(function(a){ return deleteDoc(doc(attendanceCol, a.id)); }))
        .then(function(){ return deleteDoc(doc(childrenCol, c.id, 'private', 'info')).catch(function(){}); })
        .then(function(){ return deleteDoc(doc(childrenCol, c.id)); })
        .catch(function(err){ console.error(err); alert('No se pudo borrar del todo. Revisa los permisos de Firestore.'); });
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
    if(!db || !can('ninos')) return;
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
        dias:[], extraescolares:'', activo:true, creado:Date.now(), creadoPor:state.currentEmail
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
  document.getElementById('pcFecha').value = state.selectedDate;
  renderAsistencia();
  renderOrdenadores();
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
  if(estado==='justificada' && !can('justificar')) return;
  var current = attendanceFor(childId, fecha);
  var next = current && current.estado===estado ? null : estado;
  var id = childId+'__'+fecha;
  if(next===null){
    deleteDoc(doc(attendanceCol, id)).catch(function(){});
  } else {
    setDoc(doc(attendanceCol, id), {childId:childId, fecha:fecha, estado:next, anotado:Date.now(), anotadoPor:state.currentEmail}).catch(function(){});
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
  // Solo cuentan como pendientes los que suelen venir ese día
  var pendientes = filtered.filter(function(c){
    return (c.dias||[]).indexOf(dCode)!==-1 && !attendanceFor(c.id, state.selectedDate);
  });

  document.getElementById('asisSummary').innerHTML = [
    ['Asistieron', counts.asistio, 'success'],
    ['Tarde', counts.tarde, 'brand-coral'],
    ['Faltaron', counts.falta, 'danger'],
    ['Justificadas', counts.justificada, 'warning'],
    ['Por marcar', pendientes.length, '']
  ].map(function(s){
    return '<div class="stat"><b style="'+(s[2]?'color:var(--'+s[2]+')':'')+'">'+s[1]+'</b><span>'+s[0]+'</span></div>';
  }).join('');

  // Día de cierre: avisar y no mostrar la lista salvo que se pida
  var fest = festivoOn(state.selectedDate);
  var blocked = !!fest && !state.forceList[state.selectedDate];
  var festEl = document.getElementById('asisFestivo');
  festEl.innerHTML = fest
    ? '<div class="asis-banner"><span><b>'+escapeHtml(fest.titulo)+'</b>: este día está marcado como cierre en el calendario.</span>'
      + (blocked ? '<button class="btn ghost small" type="button" id="forceListBtn">Pasar lista igualmente</button>' : '') + '</div>'
    : '';
  var forceBtn = document.getElementById('forceListBtn');
  if(forceBtn) forceBtn.addEventListener('click', function(){ state.forceList[state.selectedDate] = true; renderAsistencia(); });

  var allBtn = document.getElementById('allPresentBtn');
  allBtn.disabled = !db || blocked || !pendientes.length;
  allBtn.textContent = pendientes.length ? 'Todos asistieron ('+pendientes.length+')' : 'Todos asistieron';
  allBtn.title = state.turnoFilter==='todos' ? 'Marca como presentes a los que suelen venir hoy y aún no están marcados'
    : 'Marca como presentes a los de '+state.turnoFilter+' que suelen venir hoy y aún no están marcados';

  var listEl = document.getElementById('asisList');
  if(blocked){
    listEl.innerHTML = '<div class="empty">Día de cierre: no hay lista que pasar.</div>';
    return;
  }
  if(!active.length){
    listEl.innerHTML = '<div class="empty">No hay niños activos todavía. Añádelos en la pestaña Niños.</div>';
    return;
  }
  if(!filtered.length){
    listEl.innerHTML = '<div class="empty">Ningún niño activo tiene el turno "'+escapeHtml(state.turnoFilter)+'".</div>';
    return;
  }
  var q = state.asisSearch.trim().toLowerCase();
  var searched = q ? filtered.filter(function(c){ return (c.nombre||'').toLowerCase().indexOf(q)!==-1; }) : filtered;
  if(!searched.length){
    listEl.innerHTML = '<div class="empty">Ningún niño coincide con "'+escapeHtml(state.asisSearch.trim())+'".</div>';
    return;
  }
  var sorted = searched.slice().sort(function(a,b){
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
      + (can('justificar')
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

document.getElementById('allPresentBtn').addEventListener('click', function(){
  if(!db) return;
  var fecha = state.selectedDate, dCode = weekdayCode(fecha);
  var todo = state.children.filter(function(c){
    return c.activo!==false && matchesTurno(c) && (c.dias||[]).indexOf(dCode)!==-1 && !attendanceFor(c.id, fecha);
  });
  if(!todo.length) return;
  var btn = this;
  btn.disabled = true;
  Promise.all(todo.map(function(c){
    return setDoc(doc(attendanceCol, c.id+'__'+fecha), {childId:c.id, fecha:fecha, estado:'asistio', anotado:Date.now(), anotadoPor:state.currentEmail});
  })).catch(function(err){ console.error(err); alert('Algunos no se pudieron guardar. Vuelve a intentarlo.'); })
    .finally(function(){ renderAsistencia(); });
});

// ================= USUARIOS =================
function renderUserForm(){
  var editing = state.editingUserEmail;
  document.getElementById('userFormTitle').textContent = editing ? 'Editar usuario' : 'Añadir usuario';
  document.getElementById('usSubmitBtn').textContent = editing ? 'Guardar cambios' : 'Añadir';
  document.getElementById('usCancelBtn').style.display = editing ? 'inline-flex' : 'none';
  document.getElementById('usEmail').disabled = !!editing;
}

var usEmailEl = document.getElementById('usEmail');
var usEmailHint = document.getElementById('usEmailHint');
usEmailEl.addEventListener('input', function(){
  var raw = usEmailEl.value.trim();
  var norm = normalizeLoginId(raw);
  usEmailHint.textContent = (raw && norm !== raw.toLowerCase()) ? ('Se creará/usará en Firebase como: '+norm) : '';
});

document.getElementById('usCancelBtn').addEventListener('click', function(){
  state.editingUserEmail = null;
  document.getElementById('userForm').reset();
  document.getElementById('usEmail').disabled = false;
  usEmailHint.textContent = '';
  renderUserForm();
});

var usAdminEl = document.getElementById('usAdmin');
var usPermsWrapEl = document.getElementById('usPermsWrap');
usAdminEl.addEventListener('change', function(){
  usPermsWrapEl.style.opacity = usAdminEl.checked ? '0.4' : '1';
  usPermsWrapEl.querySelectorAll('input').forEach(function(i){ i.disabled = usAdminEl.checked; });
});

document.getElementById('userForm').addEventListener('submit', function(e){
  e.preventDefault();
  if(!db || !state.isAdmin) return;
  var email = normalizeLoginId(document.getElementById('usEmail').value);
  if(!email) return;
  var nombre = document.getElementById('usNombre').value.trim();
  var isAdminUser = usAdminEl.checked;
  var permisos = {
    ninos: document.getElementById('permNinos').checked,
    balance: document.getElementById('permBalance').checked,
    calendarioEditar: document.getElementById('permCalendario').checked,
    justificar: document.getElementById('permJustificar').checked,
    ordenadores: document.getElementById('permOrdenadores').checked
  };
  setDoc(doc(rolesCol, email), {nombre:nombre, admin:isAdminUser, permisos:permisos, actualizadoPor:state.currentEmail, actualizado:Date.now()});
  state.editingUserEmail = null;
  e.target.reset();
  document.getElementById('usEmail').disabled = false;
  usEmailHint.textContent = '';
  usAdminEl.dispatchEvent(new Event('change'));
  renderUserForm();
});

function startEditUser(u){
  state.editingUserEmail = u.id;
  document.getElementById('usEmail').value = u.id;
  document.getElementById('usNombre').value = u.nombre || '';
  usAdminEl.checked = !!u.admin;
  var p = u.permisos || {};
  document.getElementById('permNinos').checked = !!p.ninos;
  document.getElementById('permBalance').checked = !!p.balance;
  document.getElementById('permCalendario').checked = !!p.calendarioEditar;
  document.getElementById('permJustificar').checked = !!p.justificar;
  document.getElementById('permOrdenadores').checked = !!p.ordenadores;
  usAdminEl.dispatchEvent(new Event('change'));
  renderUserForm();
  document.getElementById('userForm').scrollIntoView({behavior:'smooth', block:'center'});
}

var PERM_LABELS = {ninos:'Niños', balance:'Balance', calendarioEditar:'Calendario', justificar:'Justificar', ordenadores:'Ordenadores'};
function renderUserList(){
  var el = document.getElementById('userList');
  if(!el) return;
  if(!state.roles.length){
    el.innerHTML = '<div class="empty">Todavía no hay usuarios añadidos.</div>';
    return;
  }
  var q = state.userSearch.trim().toLowerCase();
  var filteredRoles = q ? state.roles.filter(function(u){
    return (u.nombre||'').toLowerCase().indexOf(q)!==-1 || u.id.toLowerCase().indexOf(q)!==-1;
  }) : state.roles;
  if(!filteredRoles.length){
    el.innerHTML = '<div class="empty">Ningún usuario coincide con "'+escapeHtml(state.userSearch.trim())+'".</div>';
    return;
  }
  var sorted = filteredRoles.slice().sort(function(a,b){
    if(!!a.admin !== !!b.admin) return a.admin ? -1 : 1;
    return (a.nombre||a.id).localeCompare(b.nombre||b.id, 'es');
  });
  el.innerHTML = sorted.map(function(u){
    var badges = u.admin
      ? '<span class="chip on">Administrador/a</span>'
      : (Object.keys(PERM_LABELS).filter(function(k){ return u.permisos && u.permisos[k]; })
          .map(function(k){ return '<span class="chip">'+PERM_LABELS[k]+'</span>'; }).join('') || '<span class="chip">sin permisos</span>');
    return '<div class="child-row">'
      + '<div class="child-name">'+escapeHtml(u.nombre||'(sin nombre)')+'<span class="sub">'+escapeHtml(u.id)+'</span></div>'
      + '<div class="child-days">'+badges+'</div>'
      + '<div class="child-actions">'
        + '<button class="btn ghost small" data-edit-user="'+u.id+'">Editar</button>'
        + (u.id===state.currentEmail ? '' : '<button class="btn ghost small" data-del-user="'+u.id+'">Quitar acceso</button>')
      + '</div>'
      + '</div>';
  }).join('');
  el.querySelectorAll('[data-edit-user]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var u = state.roles.find(function(x){return x.id===btn.dataset.editUser;});
      if(u) startEditUser(u);
    });
  });
  el.querySelectorAll('[data-del-user]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(!db || !state.isAdmin) return;
      if(confirm('¿Quitar el acceso de '+btn.dataset.delUser+'? Esto no borra su cuenta de Firebase, solo le retira el acceso a la app. Podrás volver a añadirlo/a cuando quieras.')){
        deleteDoc(doc(rolesCol, btn.dataset.delUser));
      }
    });
  });
}

// ================= ORDENADORES =================
var PC_COUNT = 9;
function pcChildLabel(c){ return c.nombre + (c.curso ? ' — '+c.curso : ''); }
function pcKey(){ return state.selectedDate+'__'+state.pcTurno; }

document.getElementById('pcFecha').addEventListener('change', function(e){
  state.selectedDate = e.target.value || todayISO();
  document.getElementById('asisFecha').value = state.selectedDate;
  renderAsistencia();
  renderOrdenadores();
});

document.querySelectorAll('#pcTurnoFilter .ev-filter-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    state.pcTurno = btn.dataset.turno;
    document.querySelectorAll('#pcTurnoFilter .ev-filter-btn').forEach(function(b){ b.classList.toggle('active', b===btn); });
    renderOrdenadores();
  });
});

function setPuesto(n, child){
  if(!db || !can('ordenadores')) return;
  var payload = {puestos:{}};
  payload.puestos[n] = child
    ? {childId:child.id, childNombre:child.nombre, asignadoPor:state.currentEmail, asignado:Date.now()}
    : deleteField();
  setDoc(doc(ordenadoresCol, pcKey()), payload, {merge:true});
}

function renderOrdenadores(){
  document.getElementById('pcFecha').value = state.selectedDate;
  var active = state.children.filter(function(c){ return c.activo !== false; });
  var dl = document.getElementById('pcChildrenList');
  dl.innerHTML = active.map(function(c){ return '<option value="'+escapeHtml(pcChildLabel(c))+'">'; }).join('');
  var byLabel = {};
  active.forEach(function(c){ byLabel[pcChildLabel(c)] = c; });

  var turnoDoc = state.ordenadores[pcKey()] || {};
  var puestos = turnoDoc.puestos || {};
  var editable = can('ordenadores');

  var grid = document.getElementById('pcGrid');
  var html = '';
  for(var i=1;i<=PC_COUNT;i++){
    var slot = puestos[i] || null;
    html += '<div class="pc-card'+(slot?' filled':'')+'">'
      + '<div class="pc-num">Puesto '+i+'</div>'
      + '<input type="text" class="pc-input" list="pcChildrenList" data-puesto="'+i+'" value="'+(slot?escapeHtml(slot.childNombre||''):'')+'" placeholder="Escribe un nombre…"'+(editable?'':' disabled')+'>'
      + (slot && editable ? '<button class="btn ghost small" data-clear="'+i+'">Vaciar</button>' : '')
      + '</div>';
  }
  grid.innerHTML = html;

  if(editable){
    grid.querySelectorAll('input[data-puesto]').forEach(function(inp){
      inp.addEventListener('input', function(){
        var label = inp.value.trim();
        var c = byLabel[label];
        if(c) setPuesto(inp.dataset.puesto, c);
      });
      inp.addEventListener('blur', function(){
        var n = inp.dataset.puesto;
        var label = inp.value.trim();
        if(!label){
          setPuesto(n, null);
          return;
        }
        if(!byLabel[label]){
          var slot = puestos[n];
          inp.value = slot ? (slot.childNombre||'') : '';
        }
      });
    });
    grid.querySelectorAll('[data-clear]').forEach(function(btn){
      btn.addEventListener('click', function(){
        setPuesto(btn.dataset.clear, null);
      });
    });
  }
}

// ================= BALANCE =================
function renderBalance(){
  renderPeriodOptions();
  document.getElementById('exportCsvBtn').hidden = !can('balance');
  var wrap = document.getElementById('balanceWrap');
  if(!state.children.length) document.getElementById('balanceDetail').innerHTML = '';
  if(!state.children.length){
    wrap.innerHTML = '<div class="empty">Todavía no hay datos suficientes. Registra asistencia para ver el balance.</div>';
    return;
  }
  var q = state.balanceSearch.trim().toLowerCase();
  var childrenFiltered = q ? state.children.filter(function(c){ return (c.nombre||'').toLowerCase().indexOf(q)!==-1; }) : state.children;
  if(!childrenFiltered.length){
    wrap.innerHTML = '<div class="empty">Ningún niño coincide con "'+escapeHtml(state.balanceSearch.trim())+'".</div>';
    return;
  }
  var rows = computeBalanceRows(childrenFiltered);

  var html = '<div class="table-wrap scroll-list"><table><thead><tr>'
    + '<th>Niño/a</th><th>Días</th><th class="num">Sesiones</th><th class="num">Asistió</th>'
    + '<th class="num">Tarde</th><th class="num">Faltó</th><th class="num">Justif.</th><th>% Asistencia</th>'
    + '</tr></thead><tbody>';

  rows.forEach(function(r){
    var days = (r.c.dias||[]).length ? (r.c.dias||[]).join(' · ') : '—';
    var flag = r.pct!==null && r.pct<70;
    html += '<tr tabindex="0" data-child="'+r.c.id+'" class="'+(flag?'row-flag':'')+(state.detailChild===r.c.id?' sel':'')+'">'
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
  wrap.querySelectorAll('tbody tr').forEach(function(tr){
    function toggle(){ state.detailChild = state.detailChild===tr.dataset.child ? null : tr.dataset.child; renderBalance(); }
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } });
  });
  renderBalanceDetail(rows);
}

// ---- Periodo del balance ----
var periodoEl = document.getElementById('balPeriodo');
periodoEl.addEventListener('change', function(){ state.periodo = periodoEl.value; renderBalance(); });

function renderPeriodOptions(){
  var months = {};
  state.attendance.forEach(function(a){ if(a.fecha) months[a.fecha.slice(0,7)] = true; });
  var q = Math.floor(new Date().getMonth()/3);
  var opts = [['todo','Todo'],['trimestre','Este trimestre ('+MESES_ABR[q*3]+'–'+MESES_ABR[q*3+2]+')']];
  Object.keys(months).sort().reverse().forEach(function(m){
    var mo = +m.slice(5,7)-1;
    opts.push([m, MESES[mo].charAt(0).toUpperCase()+MESES[mo].slice(1)+' '+m.slice(0,4)]);
  });
  if(!opts.some(function(o){ return o[0]===state.periodo; })) state.periodo = 'todo';
  periodoEl.innerHTML = opts.map(function(o){
    return '<option value="'+o[0]+'"'+(o[0]===state.periodo?' selected':'')+'>'+escapeHtml(o[1])+'</option>';
  }).join('');
}

function inPeriod(fecha){
  if(!fecha) return false;
  if(state.periodo==='todo') return true;
  if(state.periodo==='trimestre'){
    var now = new Date(), q = Math.floor(now.getMonth()/3);
    return fecha >= isoOf(new Date(now.getFullYear(), q*3, 1)) && fecha <= isoOf(new Date(now.getFullYear(), q*3+3, 0));
  }
  return fecha.slice(0,7) === state.periodo;
}

function computeBalanceRows(children){
  return children.map(function(c){
    var recs = state.attendance.filter(function(a){ return a.childId===c.id && inPeriod(a.fecha); });
    var asistio = recs.filter(function(a){return a.estado==='asistio';}).length;
    var tarde = recs.filter(function(a){return a.estado==='tarde';}).length;
    var falta = recs.filter(function(a){return a.estado==='falta';}).length;
    var justificada = recs.filter(function(a){return a.estado==='justificada';}).length;
    // Las justificadas no penalizan: el % se calcula solo sobre asistió + tarde + faltó
    var base = asistio + tarde + falta;
    var pct = base ? Math.round(((asistio+tarde)/base)*100) : null;
    return {c:c, recs:recs, asistio:asistio, tarde:tarde, falta:falta, justificada:justificada, total:recs.length, pct:pct};
  }).sort(function(a,b){
    if(b.falta !== a.falta) return b.falta - a.falta;
    return (a.c.nombre||'').localeCompare(b.c.nombre||'', 'es');
  });
}

function renderBalanceDetail(rows){
  var el = document.getElementById('balanceDetail');
  var r = rows.find(function(x){ return x.c.id===state.detailChild; });
  if(!r){ el.innerHTML = ''; return; }
  function pills(estado){
    var ds = r.recs.filter(function(a){ return a.estado===estado; }).map(function(a){ return a.fecha; }).sort().reverse();
    return ds.length
      ? '<div class="date-pills">'+ds.map(function(f){ return '<span class="date-pill '+estado+'">'+shortDate(f)+'</span>'; }).join('')+'</div>'
      : '<span class="panel-sub">Ninguna</span>';
  }
  var meta = [r.c.curso, r.c.colegio, r.c.turno].filter(Boolean).join(' · ');
  el.innerHTML = '<div class="card" style="display:flex;flex-direction:column;gap:12px;">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;"><div><h3 style="margin:0;">'+escapeHtml(r.c.nombre)+'</h3>'
    + (meta?'<div class="panel-sub">'+escapeHtml(meta)+'</div>':'')+'</div>'
    + '<button class="btn ghost small" type="button" id="closeDetailBtn">Cerrar</button></div>'
    + '<div class="detail-lists">'
    + '<div><h4>Faltas ('+r.falta+')</h4>'+pills('falta')+'</div>'
    + '<div><h4>Justificadas ('+r.justificada+')</h4>'+pills('justificada')+'</div>'
    + '<div><h4>Tarde ('+r.tarde+')</h4>'+pills('tarde')+'</div>'
    + '</div></div>';
  document.getElementById('closeDetailBtn').addEventListener('click', function(){ state.detailChild = null; renderBalance(); });
}

// ---- Exportar a CSV (se abre en Excel) ----
document.getElementById('exportCsvBtn').addEventListener('click', function(){
  if(!can('balance')) return;
  var rows = computeBalanceRows(state.children);
  if(!rows.length) return;
  function q(v){ v = String(v==null?'':v); return /[;"\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
  function fechas(r, estado){ return r.recs.filter(function(a){ return a.estado===estado; }).map(function(a){ return a.fecha; }).sort().join(', '); }
  var lines = [['Nombre','Curso','Colegio','Turno','Días','Sesiones','Asistió','Tarde','Faltó','Justificadas','% Asistencia','Fechas de falta','Fechas justificadas'].join(';')];
  rows.forEach(function(r){
    lines.push([r.c.nombre, r.c.curso, r.c.colegio, r.c.turno, (r.c.dias||[]).join(' '), r.total, r.asistio, r.tarde, r.falta, r.justificada,
      r.pct===null?'':r.pct+'%', fechas(r,'falta'), fechas(r,'justificada')].map(q).join(';'));
  });
  var blob = new Blob(['﻿'+lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'oberti-asistencia-'+(state.periodo==='todo'?todayISO():state.periodo)+'.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
});

// ================= COPIA DE SEGURIDAD =================
document.getElementById('backupBtn').addEventListener('click', function(){
  if(!db || !can('balance')) return;
  var btn = this;
  btn.disabled = true;
  btn.textContent = 'Generando…';
  Promise.all(state.children.map(function(c){
    return getDoc(doc(childrenCol, c.id, 'private', 'info')).then(function(snap){
      var p = snap.exists() ? snap.data() : {};
      return Object.assign({}, c, {notas: p.notas||'', contacto: p.contacto||'', telefono: p.telefono||''});
    }).catch(function(){ return c; });
  })).then(function(childrenFull){
    var data = {
      exportado: new Date().toISOString(),
      children: childrenFull,
      events: state.events,
      attendance: state.attendance
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'oberti-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }).finally(function(){
    btn.disabled = false;
    btn.textContent = 'Descargar copia de seguridad';
  });
});

function renderAll(){
  renderCalendar();
  renderChildList();
  renderAsistencia();
  renderBalance();
  renderUserList();
  renderOrdenadores();
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
    rolesCol = collection(db, 'roles');
    loginsCol = collection(db, 'logins');
    ordenadoresCol = collection(db, 'ordenadores');

    setStatus('Conectando…');

    onAuthStateChanged(auth, function(user){
      detachRolesListener();
      detachOrdenadoresListener();
      if(!user){
        state.isAdmin = false;
        state.isMonitor = false;
        state.currentEmail = null;
        state.perms = defaultPerms();
        updateAuthUI();
        renderAll();
        return;
      }
      state.currentEmail = user.email;
      getDoc(doc(rolesCol, user.email)).then(function(snap){
        if(snap.exists()){
          var data = snap.data();
          state.isAdmin = data.admin === true;
          state.perms = Object.assign(defaultPerms(), data.permisos||{});
          state.isMonitor = true;
        } else {
          state.isAdmin = false;
          state.perms = defaultPerms();
          state.isMonitor = false;
        }
        if(state.isAdmin) attachRolesListener();
        if(can('ordenadores')) attachOrdenadoresListener();
        updateAuthUI();
        renderAll();
      }).catch(function(){
        state.isAdmin = false;
        state.perms = defaultPerms();
        state.isMonitor = false;
        updateAuthUI();
        renderAll();
      });
    });

    onSnapshot(childrenCol, function(snap){
      state.children = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      renderChildList(); renderAsistencia(); renderBalance();
      setStatus('Conectado', 'ok');
    }, function(err){ setStatus('Error: '+err.message, 'bad'); });

    onSnapshot(eventsCol, function(snap){
      state.events = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
      renderCalendar(); renderAsistencia();
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
