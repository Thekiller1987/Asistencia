const GAS_URL = 'https://script.google.com/macros/s/AKfycbwYclYUQE3T7wd125LJmMGbrak-ybYyw_MAjGV9znDw2JgYECqnR6lG0vF0RFQ58k7D4w/exec';

// ESTADO EN MEMORIA (Requisito: Cero LocalStorage)
const appState = {
    user: null, // { nombre, usuario, carnet, carrera, rol }
    currentRole: null, // 'Estudiante' | 'Maestro'
    scanner: null,
    // DB Cache
    globalData: { clases: [], solicitudes: [], asistencias: [], estudiantes: [] }
};

// --- CORE APP LOGIC ---
const app = {
    deferredPrompt: null,

    init: () => {
        app.initSignaturePad();
        
        document.getElementById('form-login').addEventListener('submit', app.handleLogin);
        document.getElementById('form-register').addEventListener('submit', app.handleRegister);
        const formAdmin = document.getElementById('form-register-maestro');
        if(formAdmin) formAdmin.addEventListener('submit', app.handleRegisterMaestro);
        document.getElementById('btn-logout').addEventListener('click', app.logout);
        document.getElementById('btn-install').addEventListener('click', app.installPWA);
        
        window.addEventListener('online', app.handleNetworkChange);
        window.addEventListener('offline', app.handleNetworkChange);
        app.handleNetworkChange();

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            app.deferredPrompt = e;
            document.getElementById('btn-install').classList.remove('hidden');
        });

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js')
                .then(() => console.log('Service Worker Registrado'))
                .catch(err => console.error('SW Falló', err));
        }
    },

    handleNetworkChange: () => {
        const banner = document.getElementById('offline-banner');
        const nav = document.getElementById('main-nav');
        if (!navigator.onLine) {
            banner.classList.remove('hidden');
            setTimeout(() => banner.classList.remove('-translate-y-full'), 50);
            nav.classList.add('mt-8');
            app.playSound('error-sound');
            Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: 'Ofline: Esperando conexión', showConfirmButton: false, timer: 3000 });
        } else {
            banner.classList.add('-translate-y-full');
            nav.classList.remove('mt-8');
            setTimeout(() => banner.classList.add('hidden'), 300);
            if (appState.wasOffline) {
                app.playSound('success-sound');
                Swal.fire({ toast: true, position: 'top-end', icon: 'success',  title: '¡Conexión restaurada!', showConfirmButton: false, timer: 3000 });
            }
        }
        appState.wasOffline = !navigator.onLine;
    },

    installPWA: async () => {
        if (!app.deferredPrompt) return;
        app.deferredPrompt.prompt();
        const { outcome } = await app.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            document.getElementById('btn-install').classList.add('hidden');
            app.alertSuccess('¡Gracias!', 'La app se está instalando en tu dispositivo.');
        }
        app.deferredPrompt = null;
    },

    showView: (viewId) => {
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
            setTimeout(() => el.style.display = 'none', 300);
        });
        
        setTimeout(() => {
            const view = document.getElementById(viewId);
            view.style.display = 'flex';
            setTimeout(() => view.classList.add('active'), 50);
        }, 300);

        const nav = document.getElementById('main-nav');
        if (viewId === 'view-dashboard-student' || viewId === 'view-dashboard-master') {
            nav.classList.remove('-translate-y-full');
        } else {
            nav.classList.add('-translate-y-full');
        }
    },

    selectRole: (role) => {
        appState.currentRole = role;
        
        document.getElementById('login-title').innerText = `Ingreso ${role}`;
        
        const regContainer = document.getElementById('register-container');
        if (role === 'Maestro' || role === 'Super Admin') {
            regContainer.style.display = 'none';
        } else {
            regContainer.style.display = 'block';
        }
        
        app.showView('view-login');
    },

    logout: () => {
        appState.user = null;
        appState.currentRole = null;
        appState.globalData = { clases: [], solicitudes: [], asistencias: [], estudiantes: [] };
        
        if (appState.scanner) app.stopScanner();
        
        app.showView('view-role-selection');
        app.playSound('success-sound');
    },

    showLoader: (text = 'Procesando...') => {
        document.getElementById('loader-text').innerText = text;
        document.getElementById('global-loader').style.display = 'flex';
    },

    hideLoader: () => {
        document.getElementById('global-loader').style.display = 'none';
    },

    playSound: (id) => {
        const audio = document.getElementById(id);
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => console.log('Autoplay bloqueado', e));
        }
    },

    alertSuccess: (title, text) => {
        app.playSound('success-sound');
        Swal.fire({ icon: 'success', title, text, timer: 3000, showConfirmButton: false });
    },

    alertError: (title, text) => {
        app.playSound('error-sound');
        Swal.fire({ icon: 'error', title, text });
    },

    // --- API HELPER ---
    apiCall: async (dataBody) => {
        try {
            app.showLoader('Conectando con servidor...');
            const formBody = Object.keys(dataBody).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(dataBody[key])).join('&');
            
            const response = await fetch(GAS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
                body: formBody
            });
            
            const result = await response.json();
            app.hideLoader();
            return result;
        } catch (error) {
            app.hideLoader();
            console.error(error);
            return { status: 'error', message: 'Error de red' };
        }
    },

    // --- AUTH ---
    handleLogin: async (e) => {
        e.preventDefault();
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value.trim();
        
        // Remover currentRole payload as backend handles true role verification now
        const payload = { accion: 'login', usuario: user, clave: pass, rol: appState.currentRole };
        const res = await app.apiCall(payload);
        
        if (res.status === 'success') {
            appState.user = res.data; 
            appState.user.usuario = appState.user.usuario || user; 
            
            document.getElementById('form-login').reset();
            app.playSound('success-sound');
            
            // Navigate based on Real Role assigned in BD, not the button clicked.
            if (appState.user.rol === 'Super Admin') {
                app.showView('view-dashboard-superadmin');
            } else if (appState.user.rol === 'Maestro') {
                app.loadMasterData();
            } else {
                app.loadStudentData();
            }
        } else {
            app.alertError('Credenciales Inválidas', res.message || 'Error al iniciar sesión.');
        }
    },

    handleRegister: async (e) => {
        e.preventDefault();
        const firmaBase64 = app.getSignatureData();
        
        if (!firmaBase64) {
            app.alertError('Firma Requerida', 'Debes firmar en el recuadro antes de continuar.');
            return;
        }

        const payload = {
            accion: 'registroNuevo',
            nombre: document.getElementById('reg-name').value.trim(),
            usuario: document.getElementById('reg-user').value.trim(),
            carnet: document.getElementById('reg-carnet').value.trim(),
            carrera: document.getElementById('reg-carrera').value.trim(),
            anio: document.getElementById('reg-year').value.trim(),
            clave: document.getElementById('reg-pass').value.trim(),
            genero: document.getElementById('reg-genero').value,
            firma: firmaBase64,
            rol: 'Estudiante'
        };

        const res = await app.apiCall(payload);
        
        if (res.status === 'success') {
            app.alertSuccess('Registro Exitoso', 'Cuenta creada. Inicia sesión.');
            document.getElementById('form-register').reset();
            app.clearSignature();
            app.showView('view-login');
        } else {
            app.alertError('Error', res.message || 'El usuario ya existe.');
        }
    },

    handleRegisterMaestro: async (e) => {
        e.preventDefault();
        const payload = {
            accion: 'crearMaestro',
            nombre: document.getElementById('admin-reg-name').value.trim(),
            usuario: document.getElementById('admin-reg-user').value.trim(),
            clave: document.getElementById('admin-reg-pass').value.trim()
        };

        const res = await app.apiCall(payload);
        if (res.status === 'success') {
            app.alertSuccess('Maestro Registrado', 'La cuenta docente ha sido autorizada.');
            document.getElementById('form-register-maestro').reset();
        } else {
            app.alertError('Oops', res.message);
        }
    },

    // --- MÓDULO ESTUDIANTE ---
    loadStudentData: async () => {
        document.getElementById('student-name').innerText = appState.user.nombre || 'Estudiante';
        document.getElementById('student-carnet').innerText = `Carnet: ${appState.user.carnet || 'N/A'}`;
        document.getElementById('student-carrera').innerText = appState.user.carrera || 'Universidad';
        app.showView('view-dashboard-student');

        // Obtener datos globales para ver clases disponibles
        const res = await app.apiCall({ accion: 'obtenerDatosGlobales' });
        if(res.status === 'success') {
            appState.globalData = res.data;
            app.renderStudentClasses();
        }
    },

    renderStudentClasses: () => {
        const { clases, solicitudes, asistencias } = appState.globalData;
        const selectClase = document.getElementById('student-class-select');
        const listDiv = document.getElementById('student-classes-list');
        
        // Mis Solicitudes / Matriculas (Filtrar por mi usuario)
        const misSolicitudes = solicitudes.filter(s => s.Usuario == appState.user.usuario);
        
        listDiv.innerHTML = '';
        selectClase.innerHTML = '<option value="">Seleccione una clase...</option>';

        if (misSolicitudes.length === 0) {
            listDiv.innerHTML = '<p class="text-xs text-gray-400 text-center font-medium py-3">No estás inscrito en ninguna clase aún.</p>';
        } else {
            misSolicitudes.forEach(sol => {
                const claseInfo = clases.find(c => c.ID_Clase === sol.ID_Clase);
                const nombreClase = claseInfo ? claseInfo.Nombre : sol.ID_Clase;
                const isAprobado = sol.Estado === 'Aprobado';
                
                let asistenciaHtml = '';
                if (isAprobado && claseInfo) {
                    let fechasProgramadas = [];
                    try { fechasProgramadas = JSON.parse(claseInfo.FechasPrograma); } catch(e){}
                    
                    if(fechasProgramadas.length > 0) {
                        const asistenciasMias = asistencias.filter(a => a.Usuario == appState.user.usuario && a.ID_Clase === sol.ID_Clase && (a.Estado === 'Presente' || a.Estado === 'Justificado')).length;
                        const pct = Math.round((asistenciasMias / fechasProgramadas.length) * 100);
                        const pctColor = pct < 75 ? 'text-red-500' : 'text-green-600';
                        
                        asistenciaHtml = `
                            <div class="mt-2 flex items-center justify-between text-[10px] bg-white px-2 py-1 rounded">
                                <span class="font-bold text-gray-500">Mi Asistencia:</span>
                                <span class="font-extrabold ${pctColor}">${pct}% (${asistenciasMias}/${fechasProgramadas.length})</span>
                            </div>
                        `;
                    } else {
                        asistenciaHtml = `
                            <div class="mt-2 text-[10px] text-gray-400 bg-white px-2 py-1 rounded italic">Programa sin configurar</div>
                        `;
                    }
                }

                listDiv.innerHTML += `
                    <div class="flex flex-col p-3 bg-gray-50 rounded-xl border border-gray-100">
                        <div class="flex justify-between items-center">
                            <div>
                                <p class="font-bold text-gray-800 text-sm hover:text-unan-blue transition">${nombreClase}</p>
                                <p class="text-[10px] text-gray-500 font-medium">Docente: ${claseInfo ? claseInfo.Profesor : 'N/A'}</p>
                            </div>
                            <span class="px-2 py-1 text-[10px] uppercase font-bold rounded-lg ${isAprobado ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-600'}">
                                ${isAprobado ? '✅ Inscrito' : '⏳ Pendiente'}
                            </span>
                        </div>
                        ${asistenciaHtml}
                    </div>
                `;
            });
        }

        // Llenar Clases a las que NO he solicitado aún (y que estén Activas)
        clases.filter(c => c.Estado !== 'Finalizada').forEach(c => {
            const yaSolicito = misSolicitudes.some(s => s.ID_Clase === c.ID_Clase);
            if(!yaSolicito) {
                selectClase.innerHTML += `<option value="${c.ID_Clase}">${c.Nombre} (Prof. ${c.Profesor})</option>`;
            }
        });
    },

    requestEnrollment: async () => {
        const idClase = document.getElementById('student-class-select').value;
        if(!idClase) {
            app.alertError('Alerta', 'Seleccione una clase para unirse.');
            return;
        }

        const res = await app.apiCall({
            accion: 'solicitarInscripcion',
            id_clase: idClase,
            usuario_estudiante: appState.user.usuario
        });

        if(res.status === 'success') {
            app.alertSuccess('Solicitud Enviada', 'El maestro debe aprobarte pronto.');
            app.loadStudentData(); // Refresh list
        } else {
            app.alertError('Error', res.message);
        }
    },

    startScanner: () => {
        const container = document.getElementById('scanner-container');
        container.classList.remove('hidden');

        const html5QrCode = new Html5Qrcode("reader");
        appState.scanner = html5QrCode;

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        html5QrCode.start({ facingMode: "environment" }, config, async (decodedText) => {
            app.stopScanner();
            app.playSound('success-sound');
            
            let idClase = decodedText;
            let tokenQr = null;
            try {
                const parsed = JSON.parse(decodedText);
                if (parsed.clase) {
                    idClase = parsed.clase;
                    tokenQr = parsed.token;
                }
            } catch(e) {}

            app.markAttendance(idClase, tokenQr);
        }, (errorMessage) => {
        }).catch(err => {
            container.classList.add('hidden');
            app.alertError('Cámara', 'No se puede acceder a la cámara.');
        });
    },

    stopScanner: () => {
        if (appState.scanner) {
            appState.scanner.stop().then(() => {
                appState.scanner.clear();
                appState.scanner = null;
            }).catch(e => console.log(e));
        }
        document.getElementById('scanner-container').classList.add('hidden');
    },

    markAttendance: async (idClase, tokenQr) => {
        const payload = {
            accion: 'marcarAsistencia',
            id_clase: idClase,
            token: tokenQr,
            usuario_estudiante: appState.user.usuario
        };

        const res = await app.apiCall(payload);
        
        if (res.status === 'success') {
            Swal.fire({
                icon: 'success', title: '¡Asistencia Registrada!',
                text: 'Registrado correctamente dentro del sistema UV.',
                confirmButtonColor: '#002157'
            }).then(() => {
                app.loadStudentData(); // Update personal report
            });
        } else {
            if (res.code === 'NOT_ENROLLED') {
                const conf = await Swal.fire({
                    title: 'Clase Nueva Detectada',
                    text: 'Aún no estás inscrito en esta clase. ¿Deseas solicitar inscripción al maestro?',
                    icon: 'question', showCancelButton: true,
                    confirmButtonText: 'Sí, inscribirme', cancelButtonText: 'Cancelar',
                    confirmButtonColor: '#002157'
                });
                if (conf.isConfirmed) {
                    const reqRes = await app.apiCall({ accion: 'solicitarInscripcion', id_clase: idClase, usuario_estudiante: appState.user.usuario });
                    if (reqRes.status === 'success') {
                        app.alertSuccess('Solicitud Enviada', 'El maestro debe aprobarte pronto. Una vez aprobado, escanéa el código de nuevo para marcar asistencia.');
                        app.loadStudentData();
                    } else {
                        app.alertError('Error', reqRes.message);
                    }
                }
            } else {
                app.alertError('Alerta de Asistencia', res.message);
            }
        }
    },

    // --- MÓDULO MAESTRO ---
    loadMasterData: async () => {
        document.getElementById('master-name').innerText = `Profe. ${appState.user.nombre}`;
        app.showView('view-dashboard-master');

        const res = await app.apiCall({ accion: 'obtenerDatosGlobales' });
        if(res.status === 'success') {
            appState.globalData = res.data;
            app.renderMasterViews();
            app.switchMasterTab('dashboard');
        } else {
            app.alertError('Tablero', 'No se pudieron descargar los datos de clase.');
        }
    },

    switchMasterTab: (tabId) => {
        const tabs = ['dashboard', 'clases', 'solicitudes', 'qr', 'auditoria'];
        tabs.forEach(t => {
            const btn = document.getElementById(`tab-btn-${t}`);
            const pane = document.getElementById(`tab-${t}`);
            if(t === tabId) {
                btn.className = "flex-none px-3 py-2 text-sm rounded-lg transition-all whitespace-nowrap font-bold bg-white shadow-md text-unan-blue relative";
                if(pane) pane.style.display = 'flex';
            } else {
                btn.className = "flex-none px-3 py-2 text-sm rounded-lg transition-all whitespace-nowrap font-medium text-gray-600 hover:text-unan-blue relative";
                if(pane) pane.style.display = 'none';
            }
        });

        // Asegurar que el select global cargue los datos
        if(tabId === 'dashboard') app.renderDashboard();
        if(tabId === 'auditoria') app.renderAuditoria();
    },

    renderMasterViews: () => {
        const { clases, solicitudes } = appState.globalData;
        const myClasses = clases.filter(c => c.Profesor == appState.user.nombre || c.Profesor === appState.user.usuario); // Ajuste según tu backend

        // Rellenar selects
        const dashboardSelect = document.getElementById('dashboard-class-filter');
        const qrSelect = document.getElementById('class-select');
        const auditSelect = document.getElementById('audit-class-select');
        
        const optionsHtml = myClasses.map(c => `<option value="${c.ID_Clase}">${c.Nombre} (${c.Estado})</option>`).join('');
        dashboardSelect.innerHTML = `<option value="ALL">Todas las Clases Activas</option>` + optionsHtml;
        qrSelect.innerHTML = `<option value="">Seleccione...</option>` + optionsHtml;
        if(auditSelect) auditSelect.innerHTML = `<option value="">Seleccione una Clase...</option>` + optionsHtml;

        // Render Mis Materias Activas en Tab Clases
        const myClassesList = document.getElementById('my-classes-list');
        myClassesList.innerHTML = '';
        if(myClasses.length === 0) {
            myClassesList.innerHTML = '<p class="text-sm text-center text-gray-400 py-6">Sin clases creadas.</p>';
        } else {
            myClasses.forEach(c => {
                const isActive = c.Estado !== 'Finalizada';
                myClassesList.innerHTML += `
                    <div class="bg-white border rounded-2xl p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
                        <div class="flex justify-between items-start">
                            <div class="flex-grow">
                                <p class="font-bold text-gray-800 text-lg leading-tight">${c.Nombre}</p>
                                <p class="text-xs text-gray-400 font-medium">Días: ${c.Dias || 'N/A'}</p>
                                <p class="text-[10px] mt-1 font-bold ${isActive ? 'text-green-600' : 'text-gray-400'} uppercase tracking-wider">${c.Estado}</p>
                            </div>
                            <div class="flex flex-col items-end gap-2">
                                <div class="flex gap-1">
                                    <button onclick="app.editClass('${c.ID_Clase}')" class="p-2 text-gray-400 hover:text-unan-blue transition rounded-lg hover:bg-blue-50" title="Editar Clase">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                    </button>
                                    <button onclick="app.deleteClass('${c.ID_Clase}')" class="p-2 text-gray-400 hover:text-red-500 transition rounded-lg hover:bg-red-50" title="Eliminar Permanente">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                </div>
                                <div onclick="app.showLargeCode('${c.Codigo}', '${c.Nombre}')" class="bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 flex items-center gap-1.5 cursor-pointer hover:bg-blue-50 transition-colors group">
                                    <span class="text-[10px] font-black text-gray-400 group-hover:text-unan-blue tracking-tighter uppercase transition-colors">CÓDIGO:</span>
                                    <span class="text-xs font-bold text-gray-700 tracking-widest">${c.Codigo}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-300 group-hover:text-unan-blue transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                                </div>
                            </div>
                        </div>
                        <div class="flex gap-2 border-t border-gray-100 pt-3">
                            ${isActive ? 
                                `<button onclick="app.finalizarClase('${c.ID_Clase}')" class="flex-1 text-[10px] bg-gray-100 text-gray-600 font-bold py-2 rounded-lg hover:bg-gray-200 transition">ARCHIVAR CLASE</button>` : 
                                `<span class="flex-1 text-[10px] bg-gray-50 text-gray-300 font-bold py-2 rounded-lg text-center">CLASE FINALIZADA</span>`
                            }
                        </div>
                    </div>
                `;
            });
        }

        // Render Solicitudes Pendientes (filtradas por las clases del maestro)
        const misSolicitudes = solicitudes.filter(s => myClasses.some(c => c.ID_Clase === s.ID_Clase) && s.Estado === 'Pendiente');
        const reqList = document.getElementById('requests-list');
        const badge = document.getElementById('badge-solicitudes');
        
        if(misSolicitudes.length > 0) {
            badge.classList.remove('hidden');
            badge.innerText = misSolicitudes.length;
            reqList.innerHTML = '';
            misSolicitudes.forEach(s => {
                const nombreC = myClasses.find(c => c.ID_Clase === s.ID_Clase).Nombre;
                reqList.innerHTML += `
                    <div class="bg-white border rounded-2xl p-4 flex flex-col md:flex-row justify-between items-center shadow-sm gap-3">
                        <div class="flex items-center gap-3 w-full">
                            <div class="w-10 h-10 rounded-full bg-blue-100 text-unan-blue flex justify-center items-center font-bold">
                                ${s.NombreEstudiante.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">${s.NombreEstudiante}</p>
                                <p class="text-[10px] text-gray-500 font-medium">Carnet: ${s.CarnetEstudiante} | Clase: <b class="text-unan-blue">${nombreC}</b></p>
                            </div>
                        </div>
                        <div class="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
                            <button onclick="app.gestionarSolicitud('${s.ID_Clase}', '${s.Usuario}', 'Aprobado')" class="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition">Aprobar</button>
                            <button onclick="app.gestionarSolicitud('${s.ID_Clase}', '${s.Usuario}', 'Rechazado')" class="flex-1 bg-red-100 text-red-600 hover:bg-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition">Rechazar</button>
                        </div>
                    </div>
                `;
            });
        } else {
            badge.classList.add('hidden');
            reqList.innerHTML = '<p class="text-sm text-center text-gray-400 font-medium py-10">No hay nuevas solicitudes en este momento.</p>';
        }
    },

    renderDashboard: () => {
        const { clases, solicitudes, asistencias, estudiantes } = appState.globalData;
        const selector = document.getElementById('dashboard-class-filter');
        const filterIdClass = selector.value; // 'ALL' o ID especifico
        
        const myClasses = clases.filter(c => c.Profesor == appState.user.nombre || c.Profesor === appState.user.usuario);
        const activeClassIds = myClasses.filter(c => c.Estado !== 'Finalizada').map(c => c.ID_Clase);

        let clasesToEval = filterIdClass === 'ALL' ? activeClassIds : [filterIdClass];

        // Obtener alumnos aprobados en las clases seleccionadas
        const matriculasAprobadas = solicitudes.filter(s => clasesToEval.includes(s.ID_Clase) && s.Estado === 'Aprobado');
        
        // Obtener asistencias registradas en las clases seleccionadas (Presentes y Justificados cuentan a favor)
        const asistenciasClases = asistencias.filter(a => clasesToEval.includes(a.ID_Clase) && (a.Estado === 'Presente' || a.Estado === 'Justificado'));

        // Extraer lista de usuarios únicos matriculados
        const usersAprobados = [...new Set(matriculasAprobadas.map(m => m.Usuario))];

        let stats = { totalEstudiantes: usersAprobados.length, totalSesiones: 0, globalPercent: 0 };
        let alumnosData = [];

        // Para ser 100% precisos con el calendario, leer las Fechas de Programa guardadas por clase
        usersAprobados.forEach(user => {
            const studentInfo = estudiantes.find(e => e.Usuario === user) || { Nombre: user, Carnet: 'N/A' };
            const studentClasses = matriculasAprobadas.filter(m => m.Usuario === user).map(m => m.ID_Clase);
            
            // Asistencias totales
            const studentAsist = asistenciasClases.filter(a => a.Usuario === user).length;

            let totalClasesProgramadas = 0;
            studentClasses.forEach(cId => {
                const claseInfo = clases.find(c => c.ID_Clase === cId);
                let prog = [];
                try { if(claseInfo) prog = JSON.parse(claseInfo.FechasPrograma); } catch(e){}
                totalClasesProgramadas += prog.length;
            });

            // Si aún no hay programa, % es 100 por defecto
            let pct = totalClasesProgramadas === 0 ? 100 : Math.min(100, Math.round((studentAsist / totalClasesProgramadas) * 100));
            
            alumnosData.push({
                nombre: studentInfo.Nombre,
                carnet: studentInfo.Carnet,
                usuario: user,
                presentes: studentAsist,
                total: totalClasesProgramadas,
                porcentaje: pct
            });
            stats.globalPercent += pct;
            stats.totalSesiones += studentAsist; // Total presentes (stats use)
        });

        stats.globalPercent = stats.totalEstudiantes === 0 ? 0 : Math.round(stats.globalPercent / stats.totalEstudiantes);

        // Update View
        document.getElementById('stat-total-students').innerText = stats.totalEstudiantes;
        document.getElementById('stat-avg-attendance').innerText = `${stats.globalPercent}%`;

        // Render Chart
        const ctx = document.getElementById('attendance-chart').getContext('2d');
        if (appState.chartInstance) appState.chartInstance.destroy();
        appState.chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Asistencia', 'Ausencias'],
                datasets: [{
                    data: [stats.globalPercent, 100 - stats.globalPercent],
                    backgroundColor: ['#002157', '#e5e7eb'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } }
        });

        // Render Student Cards
        const container = document.getElementById('students-cards-container');
        container.innerHTML = '';
        
        if (alumnosData.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-400 font-medium py-8">Aún no hay estudiantes matriculados/aprobados.</p>';
        } else {
            // Sort por porcentaje descendente
            alumnosData.sort((a,b) => b.porcentaje - a.porcentaje).forEach(al => {
                const isDanger = al.porcentaje < 75;
                const strokeColor = isDanger ? '#ef4444' : '#10b981'; // Red / Green
                const badgeColor = isDanger ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700';
                
                // Card UI
                container.innerHTML += `
                    <div class="bg-white border rounded-2xl p-4 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
                        <div class="flex items-center gap-4">
                            <!-- Circular Progress Avatar -->
                            <div class="relative w-12 h-12 flex justify-center items-center rounded-full bg-gray-50">
                                <svg class="w-12 h-12 absolute transform -rotate-90">
                                    <circle cx="24" cy="24" r="20" stroke="#f3f4f6" stroke-width="4" fill="none" />
                                    <circle cx="24" cy="24" r="20" stroke="${strokeColor}" stroke-width="4" fill="none" stroke-dasharray="125.6" stroke-dashoffset="${125.6 - (125.6 * al.porcentaje / 100)}" class="transition-all duration-1000" />
                                </svg>
                                <span class="text-gray-700 font-bold text-xs z-10">${al.nombre.charAt(0).toUpperCase()}</span>
                            </div>
                            
                            <div>
                                <h4 class="font-bold text-gray-800 text-sm leading-tight">${al.nombre}</h4>
                                <p class="text-[10px] text-gray-500 font-medium mt-0.5">${al.usuario} • ${al.carnet}</p>
                            </div>
                        </div>
                        
                        <div class="text-right">
                            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black ${badgeColor}">
                                ${isDanger ? '⚠️' : '✅'} ${al.porcentaje}%
                            </span>
                            <p class="text-[10px] text-gray-400 font-medium mt-1">${al.presentes}/${al.total} Días</p>
                        </div>
                    </div>
                `;
            });
        }
        
        // Save current data globally for Export
        appState.currentDashboardData = alumnosData;
    },

    // Helper para generar fechas de programa
    generateSchedule: (startDateStr, endDateStr, selectedDays) => {
        let currDate = new Date(startDateStr + "T00:00:00");
        let endDate = new Date(endDateStr + "T23:59:59");
        if (currDate > endDate) return [];

        const daysMap = { 'D': 0, 'L': 1, 'M': 2, 'X': 3, 'J': 4, 'V': 5, 'S': 6 };
        const selectedDaysNum = selectedDays.map(d => daysMap[d]);
        let fechasPrograma = [];
        
        while(currDate <= endDate) {
            if (selectedDaysNum.includes(currDate.getDay())) {
                const dayStr = String(currDate.getDate()).padStart(2, '0');
                const monStr = String(currDate.getMonth() + 1).padStart(2, '0');
                const yrStr = currDate.getFullYear();
                fechasPrograma.push(`${dayStr}/${monStr}/${yrStr}`); 
            }
            currDate.setDate(currDate.getDate() + 1);
        }
        return fechasPrograma;
    },

    createClass: async () => {
        const title = document.getElementById('new-class-name').value.trim();
        const startDateStr = document.getElementById('new-class-start-date').value;
        const endDateStr = document.getElementById('new-class-end-date').value;
        const checkboxes = document.querySelectorAll('#class-days-selector input[type="checkbox"]:checked');
        let days = [];
        checkboxes.forEach(chk => days.push(chk.value));

        if(!title || days.length === 0 || !startDateStr || !endDateStr) {
            app.alertError('Alerta', 'Ingrese el nombre, rango de fechas y al menos un día.');
            return;
        }

        const fechasPrograma = app.generateSchedule(startDateStr, endDateStr, days);

        if (fechasPrograma.length === 0) {
            app.alertError('Error', 'El rango de fechas y los días seleccionados no generan ninguna clase.');
            return;
        }

        const res = await app.apiCall({
            accion: 'crearClase',
            nombre_clase: title,
            profesor: appState.user.nombre || appState.user.usuario,
            dias: days.join(', '),
            fechas_programa: JSON.stringify(fechasPrograma),
            fecha_inicio: startDateStr,
            fecha_fin: endDateStr
        });

        if(res.status === 'success') {
            document.getElementById('new-class-name').value = '';
            document.getElementById('new-class-start-date').value = '';
            document.getElementById('new-class-end-date').value = '';
            checkboxes.forEach(chk => chk.checked = false);
            app.playSound('success-sound');
            
            Swal.fire({
                icon: 'success',
                title: 'Clase Creada',
                html: `La clase se creó con éxito.<br><br><span class="text-xs text-gray-400">CÓDIGO DE ACCESO:</span><br><b class="text-2xl text-unan-blue tracking-widest">${res.codigo}</b>`,
                confirmButtonColor: '#002157'
            }).then(() => {
                app.loadMasterData(); 
            });
        } else {
            app.alertError('Error', res.message);
        }
    },

    finalizarClase: async (idClase) => {
        const confirm = await Swal.fire({
            title: '¿Archivar Clase?', text: "La clase ya no aceptará alumnos ni códigos QR.",
            icon: 'warning', showCancelButton: true,
            confirmButtonColor: '#d33', cancelButtonColor: '#002157', confirmButtonText: 'Sí, finalizar'
        });

        if (confirm.isConfirmed) {
            const res = await app.apiCall({ accion: 'finalizarClase', id_clase: idClase });
            if(res.status === 'success') {
                app.playSound('success-sound');
                app.loadMasterData();
            } else { app.alertError('Error', res.message); }
        }
    },

    gestionarSolicitud: async (idClase, usuarioEstudiante, nuevoEstado) => {
        const res = await app.apiCall({
            accion: 'gestionarSolicitud',
            id_clase: idClase,
            usuario_estudiante: usuarioEstudiante,
            nuevo_estado: nuevoEstado // "Aprobado" o "Rechazado"
        });

        if(res.status === 'success') {
            app.playSound('success-sound');
            app.loadMasterData(); 
        } else {
            app.alertError('Error', res.message);
        }
    },

    generateQR: () => {
        const select = document.getElementById('class-select');
        const idClase = select.value;
        const nombreClase = select.options[select.selectedIndex]?.text || '';

        if (!idClase) {
            app.alertError('Error', 'Debes seleccionar una clase primero.');
            return;
        }

        const qrModal = document.getElementById('qr-modal-fullscreen');
        const qrCodeDiv = document.getElementById('qrcode');
        document.getElementById('qr-class-name').innerText = nombreClase;
        
        qrCodeDiv.innerHTML = '';
        const tokenDate = Date.now();
        
        // QR más robusto y grande
        new QRCode(qrCodeDiv, {
            text: JSON.stringify({ clase: idClase, token: tokenDate }),
            width: 512, height: 512, 
            colorDark : "#002157", colorLight : "#ffffff", 
            correctLevel : QRCode.CorrectLevel.H
        });

        qrModal.style.display = 'flex';
        qrModal.classList.remove('hidden');
        app.playSound('success-sound');
    },

    closeQRModal: () => {
        const qrModal = document.getElementById('qr-modal-fullscreen');
        qrModal.style.display = 'none';
        qrModal.classList.add('hidden');
    },

    toggleArchivedClasses: () => {
        const archivedDiv = document.getElementById('archived-classes-list');
        const btn = document.getElementById('btn-toggle-archived');
        const isHidden = archivedDiv.classList.contains('hidden');
        
        if (isHidden) {
            archivedDiv.classList.remove('hidden');
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg> Ocultar Clases Archivadas`;
            app.renderArchivedClasses();
        } else {
            archivedDiv.classList.add('hidden');
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg> Ver Clases Archivadas`;
        }
    },

    renderArchivedClasses: () => {
        const { clases } = appState.globalData;
        const myArchived = clases.filter(c => (c.Profesor == appState.user.nombre || c.Profesor === appState.user.usuario) && c.Estado === 'Finalizada');
        const div = document.getElementById('archived-classes-list');
        
        div.innerHTML = '';
        if(myArchived.length === 0) {
            div.innerHTML = '<p class="text-xs text-center text-gray-500 py-4 font-medium italic">No tienes clases archivadas.</p>';
        } else {
            myArchived.forEach(c => {
                div.innerHTML += `
                    <div class="bg-white/50 border border-gray-100 rounded-xl p-3 flex justify-between items-center">
                        <div>
                            <p class="font-bold text-gray-600 text-sm">${c.Nombre}</p>
                            <p class="text-[9px] text-gray-400">Finalizada</p>
                        </div>
                        <button onclick="app.deleteClass('${c.ID_Clase}')" class="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                `;
            });
        }
    },

    editClass: async (idClase) => {
        const claseInfo = appState.globalData.clases.find(c => c.ID_Clase === idClase);
        if(!claseInfo) return;

        // Limpiar días (quitar espacios si los hay)
        const activeDays = (claseInfo.Dias || "").split(',').map(d => d.trim());
        const daysOptions = [
            {v: 'L', l: 'L'}, {v: 'M', l: 'M'}, {v: 'X', l: 'Mi'}, 
            {v: 'J', l: 'J'}, {v: 'V', l: 'V'}, {v: 'S', l: 'S'}, {v: 'D', l: 'D'}
        ];

        let daysHtml = `<div class="flex flex-wrap gap-2 justify-center mt-2" id="swal-days-selector">`;
        daysOptions.forEach(d => {
            const isChecked = activeDays.includes(d.v);
            daysHtml += `
                <button type="button" data-value="${d.v}" onclick="this.classList.toggle('selected-day')" 
                    class="day-btn px-4 py-2 rounded-xl border-2 transition-all font-bold text-sm ${isChecked ? 'selected-day' : 'border-gray-200 text-gray-400 bg-gray-50'}">
                    ${d.l}
                </button>`;
        });
        daysHtml += `</div>
        <style>
            .day-btn.selected-day { border-color: #002157; background-color: #eff6ff; color: #002157; }
        </style>`;

        const { value: formValues } = await Swal.fire({
            title: 'Editar Materia',
            html:
                `<div class="text-left space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Nombre de Materia</label>
                        <input id="swal-name" class="swal2-input !m-0 !w-full" value="${claseInfo.Nombre}">
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Fecha Inicio</label>
                            <input type="date" id="swal-start" class="swal2-input !m-0 !w-full" value="${claseInfo.FechaInicio || ''}">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-500 mb-1">Fecha Fin</label>
                            <input type="date" id="swal-end" class="swal2-input !m-0 !w-full" value="${claseInfo.FechaFin || ''}">
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-500 mb-1">Días Impartidos</label>
                        ${daysHtml}
                    </div>
                </div>`,
            showCancelButton: true,
            confirmButtonText: 'Guardar Cambios',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#002157',
            focusConfirm: false,
            preConfirm: () => {
                const name = document.getElementById('swal-name').value;
                const start = document.getElementById('swal-start').value;
                const end = document.getElementById('swal-end').value;
                const selectedDays = Array.from(document.querySelectorAll('#swal-days-selector .selected-day')).map(btn => btn.dataset.value);

                if (!name || !start || !end || selectedDays.length === 0) {
                    Swal.showValidationMessage('Complete todos los campos y elija al menos un día');
                    return false;
                }
                return { name, start, end, selectedDays };
            }
        });

        if (formValues) {
            const { name, start, end, selectedDays } = formValues;
            const fechas = app.generateSchedule(start, end, selectedDays);
            
            if (fechas.length === 0) {
                app.alertError('Error', 'El rango de fechas y días no genera ninguna clase.');
                return;
            }

            const res = await app.apiCall({
                accion: 'editarClase',
                id_clase: idClase,
                nombre_clase: name,
                dias: selectedDays.join(', '),
                fechas_programa: JSON.stringify(fechas),
                fecha_inicio: start,
                fecha_fin: end
            });

            if(res.status === 'success') {
                app.alertSuccess('Actualizada', 'Materia y calendario actualizados correctamente.');
                app.loadMasterData();
            } else {
                app.alertError('Oops', res.message);
            }
        }
    },

    deleteClass: async (idClase) => {
        const confirm = await Swal.fire({
            title: '¿Eliminar para siempre?',
            text: "Esta acción no se puede deshacer y borrará la clase del servidor.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#002157',
            confirmButtonText: 'Sí, eliminar permanentemente',
            cancelButtonText: 'Cancelar'
        });

        if (confirm.isConfirmed) {
            const res = await app.apiCall({ accion: 'eliminarClase', id_clase: idClase });
            if(res.status === 'success') {
                app.alertSuccess('Borrado', 'La clase ha sido eliminada del sistema.');
                app.loadMasterData();
            } else {
                app.alertError('Error', res.message);
            }
        }
    },

    toggleAttendance: async (idClase, usuario, fecha, currentEstado) => {
        const nuevoEstado = currentEstado === 'Presente' ? 'Ausente' : 'Presente';
        const res = await app.apiCall({
            accion: 'modificarAsistenciaManual',
            id_clase: idClase,
            usuario_estudiante: usuario,
            fecha: fecha,
            nuevo_estado: nuevoEstado
        });

        if(res.status === 'success') {
            app.playSound('success-sound');
            // Recalcular datos locales sin hacer fetch (para que sea instantáneo)
            const index = appState.globalData.asistencias.findIndex(a => a.Fecha === fecha && a.ID_Clase === idClase && a.Usuario === usuario);
            if(nuevoEstado === 'Presente') {
                if(index === -1) appState.globalData.asistencias.push({ Fecha: fecha, ID_Clase: idClase, Usuario: usuario, Estado: 'Presente' });
            } else {
                if(index !== -1) appState.globalData.asistencias.splice(index, 1);
            }
            app.renderAuditoria();
            app.renderDashboard();
        } else {
            app.alertError('Error', res.message);
        }
    },

    renderAuditoria: () => {
        const { clases, solicitudes, asistencias, estudiantes } = appState.globalData;
        const select = document.getElementById('audit-class-select');
        const idClase = select.value;
        const tbody = document.getElementById('audit-tbody');
        const thead = document.getElementById('audit-thead');

        if (!idClase) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-10 text-center text-gray-400">Seleccione una clase para ver el programa completo.</td></tr>';
            return;
        }

        const claseInfo = clases.find(c => c.ID_Clase === idClase);
        let fechasProg = [];
        try { fechasProg = JSON.parse(claseInfo.FechasPrograma); } catch(e){}

        // Header dinámico
        let headerHtml = `
            <tr>
                <th class="p-3 font-semibold text-xs uppercase sticky left-0 bg-unan-light z-30 shadow-[2px_0_5px_rgba(0,0,0,0.1)] min-w-[200px]">Alumno</th>
                <th class="p-3 font-semibold text-xs uppercase">Carnet</th>
                <th class="p-3 font-semibold text-xs uppercase">Género</th>
                <th class="p-3 font-semibold text-xs uppercase min-w-[120px]">Firma</th>
                <th class="p-3 font-semibold text-xs uppercase text-center">%</th>
        `;
        fechasProg.forEach(f => {
            headerHtml += `<th class="p-3 font-bold text-[10px] text-center min-w-[80px] bg-blue-800 border-l border-white/10 italic">${f}</th>`;
        });
        headerHtml += `</tr>`;
        thead.innerHTML = headerHtml;

        // Body dinámico
        const matriculados = solicitudes.filter(s => s.ID_Clase === idClase && s.Estado === 'Aprobado');
        if(matriculados.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${5 + fechasProg.length}" class="p-10 text-center text-gray-400">No hay estudiantes aprobados en esta clase.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        matriculados.forEach(m => {
            const eInfo = estudiantes.find(e => e.Usuario === m.Usuario) || { Nombre: m.NombreEstudiante, Carnet: m.CarnetEstudiante, Firma: '', Genero: 'N/A' };
            const mAsistencias = asistencias.filter(a => a.ID_Clase === idClase && a.Usuario === m.Usuario && (a.Estado === 'Presente' || a.Estado === 'Justificado'));
            const pct = fechasProg.length === 0 ? 100 : Math.min(100, Math.round((mAsistencias.length / fechasProg.length) * 100));
            
            let rowHtml = `
                <tr class="hover:bg-blue-50/50 transition-colors border-b border-gray-100">
                    <td class="p-3 font-bold text-gray-800 sticky left-0 bg-white z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                        <div class="flex items-center gap-2">
                            <button onclick="app.expulsarEstudiante('${idClase}', '${m.Usuario}')" class="p-1 text-red-300 hover:text-red-500 hover:bg-red-50 rounded" title="Expulsar Estudiante">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                            </button>
                            ${eInfo.Nombre}
                        </div>
                    </td>
                    <td class="p-3 font-medium text-gray-500 text-xs">${eInfo.Carnet}</td>
                    <td class="p-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${eInfo.Genero === 'Femenino' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}">
                            ${eInfo.Genero === 'Femenino' ? 'F' : 'M'}
                        </span>
                    </td>
                    <td class="p-3">
                        ${eInfo.Firma ? `<img src="${eInfo.Firma}" class="h-8 w-auto mix-blend-multiply opacity-80" alt="Firma">` : '<span class="text-[9px] text-gray-300">Sin firma</span>'}
                    </td>
                    <td class="p-3 text-center">
                        <span class="font-black ${pct < 75 ? 'text-red-500' : 'text-green-600'}">${pct}%</span>
                    </td>
            `;

            fechasProg.forEach(f => {
                const asist = asistencias.find(a => a.Fecha === f && a.ID_Clase === idClase && a.Usuario === m.Usuario);
                const isPresent = asist && (asist.Estado === 'Presente' || asist.Estado === 'Justificado');
                rowHtml += `
                    <td class="p-3 text-center border-l border-gray-100 cursor-pointer hover:bg-white select-none transition-all" 
                        onclick="app.toggleAttendance('${idClase}', '${m.Usuario}', '${f}', '${isPresent ? 'Presente' : 'Ausente'}')">
                        <span class="transform transition-transform active:scale-150 block">
                            ${isPresent ? '✅' : '❌'}
                        </span>
                    </td>
                `;
            });

            rowHtml += `</tr>`;
            tbody.innerHTML += rowHtml;
        });
    },

    expulsarEstudiante: async (idClase, usuarioEstudiante) => {
        const confirm = await Swal.fire({
            title: '¿Expulsar Estudiante?',
            text: "El estudiante dejará de estar matriculado en esta clase.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'Sí, expulsar'
        });

        if (confirm.isConfirmed) {
            const res = await app.apiCall({
                accion: 'expulsarEstudiante',
                id_clase: idClase,
                usuario_estudiante: usuarioEstudiante
            });
            if(res.status === 'success') {
                app.playSound('success-sound');
                app.loadMasterData();
            } else {
                app.alertError('Error', res.message);
            }
        }
    },

    exportAuditoriaToExcel: () => {
        const idClase = document.getElementById('audit-class-select').value;
        if (!idClase) {
            app.alertError('Alerta', 'Seleccione una clase primero.');
            return;
        }

        const { clases, solicitudes, asistencias, estudiantes } = appState.globalData;
        const claseInfo = clases.find(c => c.ID_Clase === idClase);
        let fechasProg = [];
        try { fechasProg = JSON.parse(claseInfo.FechasPrograma); } catch(e){}
        
        const matriculados = solicitudes.filter(s => s.ID_Clase === idClase && s.Estado === 'Aprobado');
        if(matriculados.length === 0) {
            app.alertError('Alerta', 'No hay estudiantes inscritos.');
            return;
        }

        // Generar archivo Excel basado en HTML (soporta imagenes)
        let html = `
          <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
          <head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${claseInfo.Nombre}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></xml><![endif]--></head>
          <body style="font-family: Arial, sans-serif;">
            <h2 style="color: #002157;">Auditoría de Asistencia - ${claseInfo.Nombre}</h2>
            <p>Exportado el: ${new Date().toLocaleString()}</p>
            <table border="1" cellpadding="5" cellspacing="0">
              <thead>
                <tr style="background-color: #002157; color: white; font-weight: bold;">
                  <th>Estudiante</th>
                  <th>Carnet</th>
                  <th>Fecha Sesión</th>
                  <th>Estado</th>
                  <th>Hora de Marcado</th>
                  <th style="width: 150px;">Firma Digital</th>
                </tr>
              </thead>
              <tbody>
        `;

        matriculados.forEach(m => {
            const eInfo = estudiantes.find(e => e.Usuario === m.Usuario) || { Nombre: m.NombreEstudiante, Carnet: m.CarnetEstudiante, Firma: '' };
            fechasProg.forEach(f => {
                const asist = asistencias.find(a => a.Fecha === f && a.ID_Clase === idClase && a.Usuario === m.Usuario);
                const isPresent = asist && (asist.Estado === 'Presente' || asist.Estado === 'Justificado');
                const hora = asist ? asist.Hora : '-';
                const estadoTxt = isPresent ? 'Presente' : 'Ausente';
                
                html += `
                  <tr>
                    <td>${eInfo.Nombre}</td>
                    <td>${eInfo.Carnet}</td>
                    <td>${f}</td>
                    <td style="color: ${isPresent ? '#10b981' : '#ef4444'}; font-weight: bold;">${estadoTxt}</td>
                    <td>${hora}</td>
                    <td style="height: 60px; vertical-align: middle; text-align: center;">
                        ${(isPresent && eInfo.Firma) ? `<img src="${eInfo.Firma}" width="120" height="45" style="display: block; margin: auto;">` : ''}
                    </td>
                  </tr>
                `;
            });
        });

        html += `</tbody></table></body></html>`;

        const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `AUDITORIA_DETALLADA_${claseInfo.Nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.xls`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        app.playSound('success-sound');
    },

    exportToExcel: () => {
        if(!appState.currentDashboardData || appState.currentDashboardData.length === 0) {
            app.alertError('Alerta', 'No hay datos para exportar.');
            return;
        }
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
        csvContent += "Nombre,Usuario,Carnet,Días Asistidos,Total Días,Porcentaje\n";
        appState.currentDashboardData.forEach(row => {
            csvContent += `"${row.nombre}","${row.usuario}","${row.carnet}",${row.presentes},${row.total},"${row.porcentaje}%"\n`;
        });
        const filterName = document.getElementById('dashboard-class-filter').options[document.getElementById('dashboard-class-filter').selectedIndex].text.replace(/[^a-z0-9]/gi, '_');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Reporte_Asistencia_${filterName}_${new Date().toLocaleDateString().replace(/\//g,'-')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        app.playSound('success-sound');
    },

    initSignaturePad: () => {
        const canvas = document.getElementById('signature-pad');
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        let isDrawing = false;
        const resizeCanvas = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width; canvas.height = 128;
            ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.lineCap = "round";
        };
        setTimeout(resizeCanvas, 500); window.addEventListener('resize', resizeCanvas);
        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            let x, y;
            if (e.touches && e.touches.length > 0) { x = e.touches[0].clientX - rect.left; y = e.touches[0].clientY - rect.top; }
            else { x = e.clientX - rect.left; y = e.clientY - rect.top; }
            return { x, y };
        };
        const startDraw = (e) => { e.preventDefault(); isDrawing = true; const { x, y } = getPos(e); ctx.beginPath(); ctx.moveTo(x, y); };
        const draw = (e) => { if (!isDrawing) return; e.preventDefault(); const { x, y } = getPos(e); ctx.lineTo(x, y); ctx.stroke(); };
        const stopDraw = () => { if (isDrawing) { ctx.closePath(); isDrawing = false; } };
        canvas.addEventListener('mousedown', startDraw); canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDraw); canvas.addEventListener('mouseleave', stopDraw);
        canvas.addEventListener('touchstart', startDraw, { passive: false }); canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDraw);
        document.getElementById('btn-clear-sig').addEventListener('click', app.clearSignature);
    },

    clearSignature: () => {
        const canvas = document.getElementById('signature-pad');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    },

    getSignatureData: () => {
        const canvas = document.getElementById('signature-pad');
        const ctx = canvas.getContext('2d');
        const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
        const isEmpty = !pixelBuffer.some(color => color !== 0);
        if (isEmpty) return null;
        return canvas.toDataURL();
    },

    // --- NUEVAS FUNCIONES DE CÓDIGO DE CLASE (CLASSROOM STYLE) ---
    joinClassByCode: async () => {
        const input = document.getElementById('class-code-input');
        const code = input.value.trim().toUpperCase();
        
        if (code.length < 6) {
            app.alertError('Error', 'El código debe tener al menos 6 caracteres.');
            return;
        }

        const res = await app.apiCall({
            accion: 'unirsePorCodigo',
            codigo: code,
            usuario_estudiante: appState.user.usuario
        });

        if (res.status === 'success') {
            app.alertSuccess('¡Éxito!', res.message);
            input.value = '';
            app.loadStudentData();
        } else {
            app.alertError('Alerta', res.message);
        }
    },

    showLargeCode: (code, className) => {
        const modal = document.getElementById('modal-large-code');
        const display = document.getElementById('large-code-display');
        const nameDisplay = document.getElementById('large-code-class-name');
        
        display.innerText = code;
        nameDisplay.innerText = className;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    },

    closeLargeCode: () => {
        const modal = document.getElementById('modal-large-code');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
};

window.onload = app.init;
