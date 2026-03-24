const GAS_URL = 'https://script.google.com/macros/s/AKfycbwYclYUQE3T7wd125LJmMGbrak-ybYyw_MAjGV9znDw2JgYECqnR6lG0vF0RFQ58k7D4w/exec';

// --- CONFIGURACIÓN FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyAehZ3Mn__RbrOfCEJq2bPMQwb4nQ6ZIIw",
    authDomain: "asistenica-unan.firebaseapp.com",
    projectId: "asistenica-unan",
    storageBucket: "asistenica-unan.firebasestorage.app",
    messagingSenderId: "25399693880",
    appId: "1:25399693880:web:d311273c293510a1054ccd",
    measurementId: "G-D7NLM9N6ER"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const analytics = firebase.analytics();

// Habilitar persistencia offline para que la app sea instantánea
db.enablePersistence().catch(err => console.error("Error persistencia:", err.code));

const appState = {
    user: null, // { nombre, usuario, carnet, carrera, rol, id, googleEmail }
    currentRole: null, // 'Estudiante' | 'Maestro'
    scanner: null,
    listeners: [], 
    soundEnabled: true,
    editSignaturePad: null,
    globalData: { clases: [], solicitudes: [], asistencias: [], estudiantes: [] }
};

// --- CORE APP LOGIC ---
const app = {
    deferredPrompt: null,

    init: () => {
        app.initSignaturePad();
        
        const savedSoundPref = localStorage.getItem('asist_sound_pref');
        if (savedSoundPref !== null) {
            appState.soundEnabled = savedSoundPref === 'true';
        }
        
        document.getElementById('form-login').addEventListener('submit', app.handleLogin);
        document.getElementById('form-register').addEventListener('submit', app.handleRegister);
        const formAdmin = document.getElementById('form-register-maestro');
        if(formAdmin) formAdmin.addEventListener('submit', app.handleRegisterMaestro);
        document.getElementById('btn-logout').addEventListener('click', app.logout);
        document.getElementById('btn-install').addEventListener('click', app.installPWA);
        document.getElementById('form-edit-profile').addEventListener('submit', app.handleEditProfile);
        document.getElementById('btn-toggle-sound-nav').addEventListener('click', app.toggleSound);
        
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

        app.initEditSignaturePad();
        app.updateSoundUI();
        app.ensureSuperUser();

        // --- SESIÓN PERSISTENTE ---
        const savedSession = localStorage.getItem('asist_session');
        if (savedSession) {
            try {
                const userData = JSON.parse(savedSession);
                appState.user = userData;
                app.startRealTimeSync();
                
                if (userData.rol === 'maestro') {
                    app.loadMasterData();
                } else if (userData.rol === 'Super Admin') {
                    app.showView('view-dashboard-superadmin');
                } else {
                    app.loadStudentData();
                }
            } catch (e) {
                console.error("Error al restaurar sesión:", e);
                localStorage.removeItem('asist_session');
                app.showView('view-role-selection');
            }
        } else {
            app.showView('view-role-selection');
        }
    },

    ensureSuperUser: async () => {
        try {
            const query = await db.collection('users').where('usuario', '==', 'waskar').get();
            if (query.empty) {
                console.log("Creando Super Usuario por defecto...");
                await db.collection('users').add({
                    usuario: 'waskar',
                    clave: '1987',
                    nombre: 'Waskar Admin',
                    rol: 'Super Admin',
                    fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        } catch (e) {
            console.error("Error al asegurar Super Usuario:", e);
        }
    },

    // --- REAL-TIME SYNC (SOCKETS) ---
    startRealTimeSync: () => {
        app.stopRealTimeSync(); 

        const unsubClasses = db.collection('clases').onSnapshot(snapshot => {
            appState.globalData.clases = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (appState.user && appState.user.rol === 'maestro') app.renderMasterViews();
            if (appState.user && appState.user.rol === 'estudiante') app.renderStudentClasses();
        });

        if (appState.user.rol === 'estudiante') {
            const unsubInscripciones = db.collection('inscripciones')
                .where('id_estudiante', '==', appState.user.id)
                .onSnapshot(snapshot => {
                    appState.globalData.solicitudes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    app.renderStudentClasses();
                });
            const unsubTusAsistencias = db.collection('asistencias')
                .where('id_estudiante', '==', appState.user.id)
                .onSnapshot(snapshot => {
                    appState.globalData.asistencias = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    app.renderStudentClasses();
                });
            appState.listeners.push(unsubClasses, unsubInscripciones, unsubTusAsistencias);
        } else if (appState.user.rol === 'maestro') {
            const unsubSolicitudes = db.collection('inscripciones').onSnapshot(snapshot => {
                appState.globalData.solicitudes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                app.renderMasterViews();
                const currentTab = document.querySelector('#tab-navigation-container .bg-white')?.id;
                if(currentTab === 'tab-btn-dashboard') app.renderDashboard();
                if(currentTab === 'tab-btn-auditoria') app.renderAuditoria();
            });
            const unsubAsistencias = db.collection('asistencias').onSnapshot(snapshot => {
                appState.globalData.asistencias = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const currentTab = document.querySelector('#tab-navigation-container .bg-white')?.id;
                if(currentTab === 'tab-btn-dashboard') app.renderDashboard();
                if(currentTab === 'tab-btn-auditoria') app.renderAuditoria();
            });
            const unsubEstudiantes = db.collection('users').where('rol', '==', 'estudiante').onSnapshot(snapshot => {
                appState.globalData.estudiantes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            });
            appState.listeners.push(unsubClasses, unsubSolicitudes, unsubAsistencias, unsubEstudiantes);
        } else if(appState.user.rol === 'Super Admin'){
            appState.listeners.push(unsubClasses);
        }
    },

    renderClasses: () => {
        if (appState.user.rol === 'maestro') {
            app.renderMasterViews();
        } else if (appState.user.rol === 'Super Admin') {
            // Lógica para super admin si es necesaria
        } else {
            app.renderStudentClasses();
        }
    },

    stopRealTimeSync: () => {
        appState.listeners.forEach(unsub => unsub());
        appState.listeners = [];
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

    openEditProfile: () => {
        document.getElementById('edit-name').value = appState.user.nombre;
        document.getElementById('edit-user').value = appState.user.usuario;
        
        const carnetEl = document.getElementById('edit-carnet');
        const carreraEl = document.getElementById('edit-carrera');
        const sigContainer = document.getElementById('edit-signature-container');
        const linkBtn = document.getElementById('text-link-google');

        if (appState.user.rol === 'estudiante') {
            carnetEl.parentElement.classList.remove('hidden');
            carreraEl.parentElement.classList.remove('hidden');
            sigContainer.classList.remove('hidden');
            carnetEl.value = appState.user.carnet || '';
            carreraEl.value = appState.user.carrera || '';
        } else {
            carnetEl.parentElement.classList.add('hidden');
            carreraEl.parentElement.classList.add('hidden');
            sigContainer.classList.add('hidden');
        }

        linkBtn.innerText = appState.user.googleEmail ? `Vinculado: ${appState.user.googleEmail}` : 'Vincular con Google';

        const modal = document.getElementById('modal-edit-profile');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        // Redibujar canvas tras mostrar modal
        setTimeout(() => app.clearEditSignature(), 100);
    },

    closeEditProfile: () => {
        const modal = document.getElementById('modal-edit-profile');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    },

    handleEditProfile: async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('edit-name').value.trim();
        const usuario = document.getElementById('edit-user').value.trim();
        const updates = { nombre, usuario };

        if (appState.user.rol === 'estudiante') {
            updates.carnet = document.getElementById('edit-carnet').value.trim();
            updates.carrera = document.getElementById('edit-carrera').value;
            
            const newSig = app.getEditSignatureData();
            if (newSig) updates.firma = newSig;
        }

        try {
            app.showLoader('Actualizando perfil...');
            await db.collection('users').doc(appState.user.id).update(updates);

            // Actualizar estado local
            Object.assign(appState.user, updates);

            // Refrescar UI
            if (appState.user.rol === 'maestro') {
                document.getElementById('master-name').innerText = `Profe. ${appState.user.nombre}`;
            } else {
                app.loadStudentData();
            }
            
            app.hideLoader();
            app.closeEditProfile();
            app.alertSuccess('Perfil Actualizado', 'Tu información ha sido guardada con éxito.');
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudieron guardar los cambios.');
        }
    },

    linkWithGoogle: async () => {
        try {
            app.showLoader('Conectando con Google...');
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await firebase.auth().signInWithPopup(provider);
            const email = result.user.email;

            // Verificar si este email ya está en uso por otro usuario
            const query = await db.collection('users').where('googleEmail', '==', email).get();
            if (!query.empty && query.docs[0].id !== appState.user.id) {
                app.hideLoader();
                app.alertError('Error', 'Este correo de Google ya está vinculado a otra cuenta.');
                return;
            }

            await db.collection('users').doc(appState.user.id).update({ googleEmail: email });
            appState.user.googleEmail = email;
            document.getElementById('text-link-google').innerText = `Vinculado: ${email}`;

            app.hideLoader();
            app.alertSuccess('Vinculación Exitosa', `Tu cuenta ahora está asociada a ${email}`);
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo vincular la cuenta.');
        }
    },

    handleGoogleLogin: async () => {
        try {
            app.showLoader('Autenticando...');
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await firebase.auth().signInWithPopup(provider);
            const email = result.user.email;

            const query = await db.collection('users').where('googleEmail', '==', email).get();
            if (query.empty) {
                app.hideLoader();
                app.alertError('Cuenta no encontrada', 'Este correo de Google no está vinculado a ninguna cuenta. Por favor, inicia sesión normalmente y vincúlalo en tu perfil.');
                return;
            }

            const doc = query.docs[0];
            const userData = { id: doc.id, ...doc.data() };
            
            // Validar rol actual (si se seleccionó uno en la vista previa)
            const chosenRole = appState.currentRole; // 'Estudiante', 'Maestro'
            if (chosenRole === 'Estudiante' && userData.rol !== 'estudiante') {
                app.hideLoader();
                app.alertError('Rol Incorrecto', 'Esta cuenta es de nivel MAESTRO.');
                return;
            }
            if (chosenRole === 'Maestro' && userData.rol !== 'maestro') {
                app.hideLoader();
                app.alertError('Rol Incorrecto', 'Esta cuenta es de nivel ESTUDIANTE.');
                return;
            }

            appState.user = userData;
            
            // Persistencia
            const keepSession = document.getElementById('login-keep-session').checked;
            if (keepSession) {
                localStorage.setItem('asist_session', JSON.stringify(appState.user));
            }

            app.hideLoader();
            app.playSound('success-sound');
            app.startRealTimeSync();

            if (userData.rol === 'maestro') app.loadMasterData();
            else if (userData.rol === 'Super Admin') app.showView('view-dashboard-superadmin');
            else app.loadStudentData();

        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo iniciar sesión con Google.');
        }
    },



    showView: (viewId) => {
        // Controlar scroll del body para "App Feel"
        if (viewId === 'view-role-selection' || viewId === 'view-login') {
            document.body.classList.add('no-scroll');
        } else {
            document.body.classList.remove('no-scroll');
        }

        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none'; // Cambio inmediato para evitar traslapes
        });
        
        const view = document.getElementById(viewId);
        if (view) {
            view.style.display = 'flex';
            // Pequeño delay para la animación de opacidad
            setTimeout(() => view.classList.add('active'), 10);
        }

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
        app.stopRealTimeSync();
        appState.user = null;
        appState.currentRole = null;
        appState.globalData = { clases: [], solicitudes: [], asistencias: [], estudiantes: [] };
        
        localStorage.removeItem('asist_session');
        
        if (appState.scanner) app.stopScanner();
        
        document.body.classList.remove('no-scroll');
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
        if (appState.soundEnabled === false) return;
        const audio = document.getElementById(id);
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => console.log('Autoplay bloqueado', e));
        }
    },

    updateSoundUI: () => {
        const els = [
            {on: 'icon-sound-on', off: 'icon-sound-off', text: 'text-sound-status'},
            {on: 'icon-sound-on-role', off: 'icon-sound-off-role', text: 'text-sound-status-role'},
            {on: 'icon-sound-on-nav', off: 'icon-sound-off-nav'}
        ];
        els.forEach(group => {
            const iconOn = document.getElementById(group.on);
            const iconOff = document.getElementById(group.off);
            const textStatus = group.text ? document.getElementById(group.text) : null;
            if (iconOn && iconOff) {
                if (appState.soundEnabled) {
                    iconOn.classList.remove('hidden');
                    iconOff.classList.add('hidden');
                    if (textStatus) textStatus.innerText = 'Sonidos On';
                } else {
                    iconOn.classList.add('hidden');
                    iconOff.classList.remove('hidden');
                    if (textStatus) textStatus.innerText = 'Sonidos Off';
                }
            }
        });
    },

    toggleSound: () => {
        appState.soundEnabled = !appState.soundEnabled;
        localStorage.setItem('asist_sound_pref', appState.soundEnabled);
        app.updateSoundUI();
        if (appState.soundEnabled) {
            app.playSound('success-sound');
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

    // --- AUTH (FIREBASE) ---
    handleLogin: async (e) => {
        e.preventDefault();
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value.trim();
        
        try {
            app.showLoader('Verificando credenciales...');
            
            // Buscar usuario en Firestore
            const snapshot = await db.collection('users')
                .where('usuario', '==', user)
                .where('clave', '==', pass)
                .get();

            if (snapshot.empty) {
                app.hideLoader();
                app.alertError('Credenciales Inválidas', 'Usuario o contraseña incorrectos.');
                return;
            }

            const userData = snapshot.docs[0].data();
            const actualRole = userData.rol;
            const chosenView = appState.currentRole; // 'Estudiante', 'Maestro' o 'Super Admin'

            if (chosenView === 'Estudiante' && actualRole !== 'estudiante') {
                app.hideLoader();
                app.alertError('Acceso Denegado', 'Esta cuenta es de nivel DOCENTE. Por favor, ingresa por la vista de Maestro.');
                return;
            }
            if (chosenView === 'Maestro' && actualRole !== 'maestro') {
                app.hideLoader();
                app.alertError('Acceso Denegado', 'Esta cuenta es de nivel ESTUDIANTE. Por favor, ingresa por la vista de Estudiante.');
                return;
            }
            if (chosenView === 'Super Admin' && actualRole !== 'Super Admin') {
                app.hideLoader();
                app.alertError('Acceso Denegado', 'No tienes permisos de Administrador.');
                return;
            }

            appState.user = { id: snapshot.docs[0].id, ...userData };
            
            // --- GUARDAR SESIÓN SI EL USUARIO LO PIDIÓ ---
            const keepSession = document.getElementById('login-keep-session').checked;
            if (keepSession) {
                localStorage.setItem('asist_session', JSON.stringify(appState.user));
            }

            app.hideLoader();
            app.playSound('success-sound');
            document.getElementById('form-login').reset();

            // Iniciar Sockets en Tiempo Real
            app.startRealTimeSync();

            // Navegar según Rol
            if (appState.user.rol === 'maestro') {
                app.loadMasterData();
            } else if (appState.user.rol === 'Super Admin') {
                app.showView('view-dashboard-superadmin');
            } else {
                app.loadStudentData();
            }

        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error de Conexión', 'No se pudo conectar con Firebase.');
        }
    },

    handleRegister: async (e) => {
        e.preventDefault();
        const firmaBase64 = app.getSignatureData();
        
        if (!firmaBase64) {
            app.alertError('Firma Requerida', 'Debes firmar en el recuadro antes de continuar.');
            return;
        }

        const usuario = document.getElementById('reg-user').value.trim();
        
        try {
            app.showLoader('Creando cuenta...');

            // Verificar si el usuario ya existe
            const exists = await db.collection('users').where('usuario', '==', usuario).get();
            if (!exists.empty) {
                app.hideLoader();
                app.alertError('Error', 'El nombre de usuario ya está en uso.');
                return;
            }

            const newUserData = {
                nombre: document.getElementById('reg-name').value.trim(),
                usuario: usuario,
                carnet: document.getElementById('reg-carnet').value.trim(),
                carrera: document.getElementById('reg-carrera').value.trim(),
                anio: document.getElementById('reg-year').value.trim(),
                clave: document.getElementById('reg-pass').value.trim(),
                genero: document.getElementById('reg-genero').value,
                firma: firmaBase64,
                rol: 'estudiante',
                fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
            };

            await db.collection('users').add(newUserData);
            
            app.hideLoader();
            app.alertSuccess('¡Bienvenido!', 'Cuenta creada exitosamente. Inicia sesión.');
            document.getElementById('form-register').reset();
            app.clearSignature();
            app.showView('view-login');

        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo completar el registro.');
        }
    },

    handleRegisterMaestro: async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('admin-reg-name').value.trim();
        const usuario = document.getElementById('admin-reg-user').value.trim();
        const clave = document.getElementById('admin-reg-pass').value.trim();

        try {
            app.showLoader('Registrando maestro...');
            
            // Verificar si ya existe
            const exists = await db.collection('users').where('usuario', '==', usuario).get();
            if (!exists.empty) {
                app.hideLoader();
                app.alertError('Error', 'El nombre de usuario ya está en uso.');
                return;
            }

            await db.collection('users').add({
                nombre,
                usuario,
                clave,
                rol: 'maestro',
                fechaRegistro: firebase.firestore.FieldValue.serverTimestamp()
            });

            app.hideLoader();
            app.alertSuccess('Maestro Registrado', 'La cuenta docente ha sido autorizada en Firebase.');
            document.getElementById('form-register-maestro').reset();
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo autorizar la cuenta.');
        }
    },

    // --- MÓDULO ESTUDIANTE ---
    loadStudentData: async () => {
        if (!appState.user) return;
        
        // Actualizar UI básica
        document.getElementById('student-name').innerText = appState.user.nombre || 'Estudiante';
        document.getElementById('student-carnet').innerText = `Carnet: ${appState.user.carnet || 'N/A'}`;
        document.getElementById('student-carrera').innerText = appState.user.carrera || 'Universidad';
        
        // Iniciales para el avatar
        const initials = (appState.user.nombre || '?').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
        const initialsEl = document.getElementById('student-initials');
        if (initialsEl) initialsEl.innerText = initials;

        app.showView('view-dashboard-student');
        app.startRealTimeSync(); 
    },

    renderStudentClasses: () => {
        const { clases, solicitudes, asistencias } = appState.globalData;
        const listDiv = document.getElementById('student-classes-list');
        const selectClase = document.getElementById('student-class-select');
        
        const misSolicitudes = solicitudes.filter(s => s.id_estudiante === appState.user.id);
        
        listDiv.innerHTML = '';
        selectClase.innerHTML = '<option value="">Seleccione una clase...</option>';

        if (misSolicitudes.length === 0) {
            listDiv.innerHTML = `
                <div class="flex flex-col items-center justify-center py-10 opacity-40">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                    <p class="text-xs font-bold uppercase tracking-widest">Sin materias aún</p>
                </div>
            `;
        } else {
            misSolicitudes.forEach(sol => {
                const claseInfo = clases.find(c => c.id === sol.id_clase);
                const isAprobado = sol.estado === 'Aprobada';
                const nombreClase = claseInfo ? claseInfo.Nombre : sol.nombre_clase;
                
                let statsHtml = '';
                if (isAprobado && claseInfo) {
                    let prog = [];
                    try { prog = JSON.parse(claseInfo.FechasPrograma); } catch(e){}
                    // Filtrar solo las presentes válidas
                    const misAsist = asistencias.filter(a => a.id_estudiante === appState.user.id && a.id_clase === sol.id_clase && a.estado === 'Presente').length;
                    const total = prog.length;
                    
                    let actAsist = Math.min(misAsist, total); // safe check por bugs previos
                    const pct = total === 0 ? 0 : Math.round((actAsist/total)*100);
                    
                    statsHtml = `
                        <div class="mt-3">
                            <div class="flex justify-between items-end mb-1.5">
                                <span class="text-[9px] font-black text-gray-400 uppercase tracking-tighter">Asistencia: ${misAsist}/${total}</span>
                                <span class="text-[10px] font-black ${pct < 75 ? 'text-red-500' : 'text-green-600'}">${pct}%</span>
                            </div>
                            <div class="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div class="h-full ${pct < 75 ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]' : 'bg-green-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'} transition-all duration-1000" style="width: ${pct}%"></div>
                            </div>
                        </div>
                    `;
                }

                listDiv.innerHTML += `
                    <div class="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all group">
                        <div class="flex justify-between items-start">
                            <div class="max-w-[70%]">
                                <h5 class="font-black text-gray-800 text-sm leading-tight group-hover:text-unan-blue transition-colors truncate">${nombreClase}</h5>
                                <p class="text-[10px] text-gray-400 font-bold mt-0.5 truncate uppercase">Prof. ${claseInfo ? claseInfo.Profesor : 'Asignando...'}</p>
                            </div>
                            <span class="px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter ${isAprobado ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-600'}">
                                ${isAprobado ? 'ACTIVA' : 'PENDIENTE'}
                            </span>
                        </div>
                        ${statsHtml}
                    </div>
                `;
            });
        }

        // Catálogo para inscripción
        clases.filter(c => c.Estado === 'Activa').forEach(c => {
            const yaSolicito = misSolicitudes.some(s => s.id_clase === c.id);
            if(!yaSolicito) {
                selectClase.innerHTML += `<option value="${c.id}" class="font-bold">${c.Nombre} (Prof. ${c.Profesor})</option>`;
            }
        });
    },

    requestEnrollment: async () => {
        const idClase = document.getElementById('student-class-select').value;
        if(!idClase) {
            app.alertError('Alerta', 'Seleccione una clase para unirse.');
            return;
        }

        try {
            app.showLoader('Enviando solicitud...');
            const claseInfo = appState.globalData.clases.find(c => c.id === idClase);
            
            await db.collection('inscripciones').add({
                id_clase: idClase,
                id_estudiante: appState.user.id,
                nombre_estudiante: appState.user.nombre,
                carnet_estudiante: appState.user.carnet,
                nombre_clase: claseInfo ? claseInfo.Nombre : '?',
                estado: 'Pendiente',
                fechaSolicitud: firebase.firestore.FieldValue.serverTimestamp()
            });
            app.hideLoader();
            app.alertSuccess('Solicitud Enviada', 'El maestro debe aprobarte pronto.');
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo enviar la solicitud.');
        }
    },

    startScanner: async () => {
        // Enfoque nativo: simplemente activamos el input de archivo
        const fileInput = document.getElementById('qr-input-file');
        if (fileInput) fileInput.click();
    },

    handleFileSelect: async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        app.showLoader('Escaneando Foto...');
        
        // Usar Html5Qrcode para escanear el archivo
        // "reader" es el div que ya existe en el HTML
        const html5QrCode = new Html5Qrcode("reader");
        
        try {
            const decodedText = await html5QrCode.scanFile(file, true);
            app.hideLoader();
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
            
            // Limpiar input
            event.target.value = '';
        } catch (err) {
            app.hideLoader();
            console.error("Error QR:", err);
            app.alertError('QR No Detectado', 'No pudimos encontrar un código QR en la foto. Intenta tomarla más de cerca y con buena luz.');
            event.target.value = '';
        }
    },

    togglePasswordVisibility: () => {
        const passInput = document.getElementById('login-pass');
        const iconOpen = document.getElementById('icon-eye-open');
        const iconClosed = document.getElementById('icon-eye-closed');
        
        if (passInput.type === 'password') {
            passInput.type = 'text';
            iconOpen.classList.add('hidden');
            iconClosed.classList.remove('hidden');
        } else {
            passInput.type = 'password';
            iconOpen.classList.remove('hidden');
            iconClosed.classList.add('hidden');
        }
    },

    stopScanner: () => {
        // En el flujo nativo no hay stream que detener
        document.getElementById('scanner-container').classList.add('hidden');
    },

    markAttendance: async (idClase, tokenQr) => {
        try {
            app.showLoader('Registrando asistencia...');
            
            // 1. Verificar si existe la clase
            const classDoc = await db.collection('clases').doc(idClase).get();
            if (!classDoc.exists) {
                app.hideLoader();
                app.alertError('Error', 'La clase no existe.');
                return;
            }

            // 2. Verificar Inscripción
            const insq = await db.collection('inscripciones')
                .where('id_clase', '==', idClase)
                .where('id_estudiante', '==', appState.user.id)
                .where('estado', '==', 'Aprobada')
                .get();

            if (insq.empty) {
                app.hideLoader();
                const conf = await Swal.fire({
                    title: 'Clase Nueva Detectada',
                    text: 'Aún no estás inscrito en esta clase. ¿Deseas solicitar inscripción al maestro?',
                    icon: 'question', showCancelButton: true,
                    confirmButtonText: 'Sí, inscribirme', cancelButtonText: 'Cancelar',
                    confirmButtonColor: '#002157'
                });
                if (conf.isConfirmed) {
                    await db.collection('inscripciones').add({
                        id_clase: idClase,
                        id_estudiante: appState.user.id,
                        nombre_estudiante: appState.user.nombre,
                        carnet_estudiante: appState.user.carnet,
                        nombre_clase: classDoc.data().Nombre,
                        estado: 'Pendiente',
                        fechaSolicitud: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    app.alertSuccess('Solicitud Enviada', 'El maestro debe aprobarte pronto.');
                }
                return;
            }

            // 3. Prevent Double Scanning and Format Exact Date
            const now = new Date();
            const dayStr = String(now.getDate()).padStart(2, '0');
            const monStr = String(now.getMonth() + 1).padStart(2, '0');
            const yrStr = now.getFullYear();
            const todayStr = `${dayStr}/${monStr}/${yrStr}`;

            const checkQuery = await db.collection('asistencias')
                .where('id_clase', '==', idClase)
                .where('id_estudiante', '==', appState.user.id)
                .where('fecha', '==', todayStr)
                .get();
                
            if (!checkQuery.empty) {
                app.hideLoader();
                app.playSound('success-sound');
                Swal.fire({ icon: 'info', title: 'Ya Registrado', text: 'Tu asistencia para hoy ya fue guardada previamente.', confirmButtonColor: '#002157' });
                return;
            }

            // 4. Registrar Asistencia Definitiva
            await db.collection('asistencias').add({
                id_clase: idClase,
                id_estudiante: appState.user.id,
                nombre_estudiante: appState.user.nombre,
                fecha: todayStr,
                hora: now.toLocaleTimeString(),
                estado: 'Presente',
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            app.hideLoader();
            app.playSound('success-sound');
            Swal.fire({ icon: 'success', title: '¡Asistencia Registrada!', text: 'Se ha guardado en tiempo real.', confirmButtonColor: '#002157' });

        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo marcar asistencia.');
        }
    },

    // --- MÓDULO MAESTRO (FIREBASE REPLACEMENT) ---
    loadMasterData: async () => {
        document.getElementById('master-name').innerText = `Profe. ${appState.user.nombre}`;
        app.showView('view-dashboard-master');
        app.startRealTimeSync(); 
        app.switchMasterTab('dashboard');
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
        const myClasses = clases.filter(c => c.ProfesorId === appState.user.id && c.Estado !== 'Eliminada'); 

        // Rellenar selects
        const dashboardSelect = document.getElementById('dashboard-class-filter');
        const qrSelect = document.getElementById('class-select');
        const auditSelect = document.getElementById('audit-class-select');
        
        const optionsHtml = myClasses.map(c => `<option value="${c.id}">${c.Nombre} (${c.Estado})</option>`).join('');
        dashboardSelect.innerHTML = `<option value="ALL">Todas las Clases Activas</option>` + optionsHtml;
        qrSelect.innerHTML = `<option value="">Seleccione...</option>` + optionsHtml;
        if(auditSelect) auditSelect.innerHTML = `<option value="">Seleccione una Clase...</option>` + optionsHtml;

        // Render Mis Materias en Tab Clases
        const myClassesList = document.getElementById('my-classes-list');
        myClassesList.innerHTML = '';
        if(myClasses.length === 0) {
            myClassesList.innerHTML = '<p class="text-sm text-center text-gray-400 py-6">Sin clases creadas.</p>';
        } else {
            myClasses.forEach(c => {
                const isActive = c.Estado === 'Activa';
                myClassesList.innerHTML += `
                    <div class="bg-white border rounded-2xl p-4 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">
                        <div class="flex justify-between items-start">
                            <div class="flex-grow">
                                <p class="font-bold text-gray-800 text-lg leading-tight w-full pr-8">${c.Nombre}</p>
                                <p class="text-xs text-gray-400 font-medium">Días: ${c.Dias || 'N/A'}</p>
                                <p class="text-[10px] mt-1 font-bold ${isActive ? 'text-green-600' : 'text-gray-400'} uppercase tracking-wider">${c.Estado}</p>
                            </div>
                            <!-- Action Buttons restored -->
                            <div class="flex gap-2 shrink-0">
                                <button onclick="app.editClass('${c.id}')" class="p-2 text-blue-400 hover:text-onan-blue hover:bg-blue-50 rounded-xl transition" title="Editar Materia">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                                <button onclick="app.deleteClass('${c.id}')" class="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition" title="Eliminar clase">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                        </div>
                        <div class="flex gap-2 border-t border-gray-100 pt-3">
                            ${isActive ? 
                                `<button onclick="app.finalizarClase('${c.id}')" class="flex-1 text-[10px] bg-gray-100 text-gray-600 font-bold py-2 rounded-lg hover:bg-gray-200 transition">ARCHIVAR CLASE</button>` : 
                                `<span class="flex-1 text-[10px] bg-gray-50 text-gray-300 font-bold py-2 rounded-lg text-center">CLASE FINALIZADA</span>`
                            }
                        </div>
                    </div>
                `;
            });
        }

        // Render Solicitudes Pendientes (filtradas por las clases del maestro)
        const misSolicitudes = solicitudes.filter(s => myClasses.some(c => c.id === s.id_clase) && s.estado === 'Pendiente');
        const reqList = document.getElementById('requests-list');
        const badge = document.getElementById('badge-solicitudes');
        
        if(misSolicitudes.length > 0) {
            badge.classList.remove('hidden');
            badge.innerText = misSolicitudes.length;
            reqList.innerHTML = '';
            misSolicitudes.forEach(s => {
                reqList.innerHTML += `
                    <div class="bg-white border rounded-2xl p-4 flex flex-col md:flex-row justify-between items-center shadow-sm gap-3">
                        <div class="flex items-center gap-3 w-full">
                            <div class="w-10 h-10 rounded-full bg-blue-100 text-unan-blue flex justify-center items-center font-bold">
                                ${s.nombre_estudiante.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <p class="font-bold text-gray-800 text-sm">${s.nombre_estudiante}</p>
                                <p class="text-[10px] text-gray-500 font-medium">Carnet: ${s.carnet_estudiante} | Clase: <b class="text-unan-blue">${s.nombre_clase}</b></p>
                            </div>
                        </div>
                        <div class="flex gap-2 w-full md:w-auto mt-2 md:mt-0">
                            <button onclick="app.approveEnrollment('${s.id}')" class="flex-1 bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95">Aprobar</button>
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
        const { clases, solicitudes, asistencias } = appState.globalData;
        const selector = document.getElementById('dashboard-class-filter');
        const filterIdClass = selector.value; // 'ALL' o ID específico
        
        const myClasses = clases.filter(c => c.ProfesorId === appState.user.id);
        const activeClassIds = myClasses.filter(c => c.Estado === 'Activa').map(c => c.id);

        let clasesToEval = filterIdClass === 'ALL' ? activeClassIds : [filterIdClass];

        // Obtener alumnos aprobados en las clases seleccionadas
        const matriculasAprobadas = solicitudes.filter(s => clasesToEval.includes(s.id_clase) && s.estado === 'Aprobada');
        
        // Obtener asistencias registradas
        const asistenciasClases = asistencias.filter(a => clasesToEval.includes(a.id_clase));

        // Usuarios únicos matriculados
        const idsEstudiantes = [...new Set(matriculasAprobadas.map(m => m.id_estudiante))];

        let stats = { totalEstudiantes: idsEstudiantes.length, globalPercent: 0 };
        let alumnosData = [];

        idsEstudiantes.forEach(estId => {
            const matriculas = matriculasAprobadas.filter(m => m.id_estudiante === estId);
            const nombreEst = matriculas[0].nombre_estudiante;
            const carnetEst = matriculas[0].carnet_estudiante;
            
            // Asistencias del estudiante en días programados (para evitar desfaces pasados de rosca)
            const studentAsist = asistenciasClases.filter(a => a.id_estudiante === estId && a.estado === 'Presente').length;

            let totalDiasProgramados = 0;
            matriculas.forEach(m => {
                const claseInfo = clases.find(c => c.id === m.id_clase);
                let prog = [];
                try { if(claseInfo) prog = JSON.parse(claseInfo.FechasPrograma); } catch(e){}
                totalDiasProgramados += prog.length;
            });

            // Evitar que el PCT sea mayor a 100 por bugs anteriores en base de datos de test
            let actAsist = Math.min(studentAsist, totalDiasProgramados);
            let pct = totalDiasProgramados === 0 ? 100 : Math.round((actAsist / totalDiasProgramados) * 100);
            
            alumnosData.push({
                nombre: nombreEst,
                carnet: carnetEst,
                id: estId,
                presentes: studentAsist,
                total: totalDiasProgramados,
                porcentaje: pct
            });
            stats.globalPercent += pct;
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
            container.innerHTML = '<p class="text-center text-gray-400 font-medium py-8">No hay alumnos por mostrar.</p>';
        } else {
            alumnosData.sort((a,b) => b.porcentaje - a.porcentaje).forEach(al => {
                const isDanger = al.porcentaje < 75;
                const strokeColor = isDanger ? '#ef4444' : '#10b981';
                const badgeColor = isDanger ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700';
                
                container.innerHTML += `
                    <div class="bg-white border rounded-2xl p-4 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
                        <div class="flex items-center gap-4">
                            <div class="relative w-12 h-12 flex justify-center items-center rounded-full bg-gray-50">
                                <svg class="w-12 h-12 absolute transform -rotate-90">
                                    <circle cx="24" cy="24" r="20" stroke="#f3f4f6" stroke-width="4" fill="none" />
                                    <circle cx="24" cy="24" r="20" stroke="${strokeColor}" stroke-width="4" fill="none" stroke-dasharray="125.6" stroke-dashoffset="${125.6 - (125.6 * al.porcentaje / 100)}" class="transition-all duration-1000" />
                                </svg>
                                <span class="text-gray-700 font-bold text-xs z-10">${al.nombre.charAt(0).toUpperCase()}</span>
                            </div>
                            <div>
                                <h4 class="font-bold text-gray-800 text-sm leading-tight">${al.nombre}</h4>
                                <p class="text-[10px] text-gray-500 font-medium mt-0.5">${al.carnet}</p>
                            </div>
                        </div>
                        <div class="text-right">
                            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black ${badgeColor}">
                                ${al.porcentaje}%
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

        try {
            app.showLoader('Guardando clase...');
            await db.collection('clases').add({
                Nombre: title,
                Profesor: appState.user.nombre,
                ProfesorId: appState.user.id,
                Dias: days.join(', '),
                FechasPrograma: JSON.stringify(fechasPrograma),
                FechaInicio: startDateStr,
                FechaFin: endDateStr,
                Estado: 'Activa',
                FechaCreacion: firebase.firestore.FieldValue.serverTimestamp()
            });
            app.hideLoader();
            app.playSound('success-sound');
            app.alertSuccess('Clase Creada', 'La clase se sincronizó en tiempo real.');
            
            // Cerrar y resetear modal
            document.getElementById('modal-new-class').classList.add('hidden');
            document.getElementById('modal-new-class').classList.remove('flex');
            document.getElementById('new-class-name').value = '';
            document.getElementById('new-class-start-date').value = '';
            document.getElementById('new-class-end-date').value = '';
            document.querySelectorAll('#class-days-selector input[type="checkbox"]').forEach(chk => chk.checked = false);
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo crear la clase en Firestore.');
        }
    },

    approveEnrollment: async (solicitudId) => {
        try {
            app.showLoader('Aprobando estudiate...');
            await db.collection('inscripciones').doc(solicitudId).update({
                estado: 'Aprobada',
                fechaAprobacion: firebase.firestore.FieldValue.serverTimestamp()
            });
            app.hideLoader();
            app.playSound('success-sound');
        } catch (error) {
            app.hideLoader();
            app.alertError('Error', 'No se pudo aprobar la solicitud.');
        }
    },


    finalizarClase: async (idClase) => {
        const confirm = await Swal.fire({
            title: '¿Archivar Clase?', text: "La clase ya no aceptará alumnos ni códigos QR.",
            icon: 'warning', showCancelButton: true,
            confirmButtonColor: '#d33', cancelButtonColor: '#002157', confirmButtonText: 'Sí, finalizar'
        });

        if (confirm.isConfirmed) {
            try {
                app.showLoader('Finalizando...');
                await db.collection('clases').doc(idClase).update({
                    Estado: 'Finalizada'
                });
                app.hideLoader();
                app.playSound('success-sound');
            } catch (error) {
                app.hideLoader();
                app.alertError('Error', 'No se pudo archivar la clase.');
            }
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
                        <button onclick="app.deleteClass('${c.id}')" class="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                `;
            });
        }
    },

    editClass: async (idClase) => {
        const claseInfo = appState.globalData.clases.find(c => c.id === idClase);
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

            try {
                app.showLoader('Actualizando...');
                await db.collection('clases').doc(idClase).update({
                    Nombre: name,
                    Dias: selectedDays.join(', '),
                    FechasPrograma: JSON.stringify(fechas),
                    FechaInicio: start,
                    FechaFin: end
                });
                app.hideLoader();
                app.alertSuccess('Actualizada', 'Materia y calendario actualizados correctamente.');
            } catch (error) {
                app.hideLoader();
                console.error(error);
                app.alertError('Oops', 'No se pudo actualizar la clase en Firebase.');
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
            try {
                app.showLoader('Eliminando...');
                await db.collection('clases').doc(idClase).update({
                    Estado: 'Eliminada'
                });
                app.hideLoader();
                app.alertSuccess('Borrado', 'La clase ha sido eliminada del sistema.');
            } catch (error) {
                app.hideLoader();
                console.error(error);
                app.alertError('Error', 'No se pudo eliminar la clase.');
            }
        }
    },

    toggleAttendance: async (idClase, idEstudiante, nombreEstudiante, fecha, currentEstado) => {
        const nuevoEstado = currentEstado === 'Presente' ? 'Ausente' : 'Presente';
        
        try {
            app.showLoader('Guardando...');
            const query = await db.collection('asistencias')
                .where('id_clase', '==', idClase)
                .where('id_estudiante', '==', idEstudiante)
                .where('fecha', '==', fecha)
                .get();

            if (nuevoEstado === 'Presente') {
                if (query.empty) {
                    await db.collection('asistencias').add({
                        id_clase: idClase,
                        id_estudiante: idEstudiante,
                        nombre_estudiante: nombreEstudiante,
                        fecha: fecha,
                        hora: 'Manual',
                        estado: 'Presente',
                        timestamp: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            } else {
                if (!query.empty) {
                    const batch = db.batch();
                    query.docs.forEach(d => batch.delete(d.ref));
                    await batch.commit();
                }
            }
            app.hideLoader();
            app.playSound('success-sound');
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo actualizar la asistencia.');
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

        const claseInfo = clases.find(c => c.id === idClase);
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
        const matriculados = solicitudes.filter(s => s.id_clase === idClase && s.estado === 'Aprobada');
        if(matriculados.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${5 + fechasProg.length}" class="p-10 text-center text-gray-400">No hay estudiantes aprobados en esta clase.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        matriculados.forEach(m => {
            const eInfo = estudiantes.find(e => e.id === m.id_estudiante) || { nombre: m.nombre_estudiante, carnet: m.carnet_estudiante, firma: '', genero: 'N/A' };
            
            // Calculamos asisencias presentes que estrictamente correspondan al programa validado
            let numPresentes = 0;
            fechasProg.forEach(f => {
                const asist = asistencias.find(a => a.fecha === f && a.id_clase === idClase && a.id_estudiante === m.id_estudiante);
                if (asist) numPresentes++;
            });

            const pct = fechasProg.length === 0 ? 100 : Math.min(100, Math.round((numPresentes / fechasProg.length) * 100));
            
            let rowHtml = `
                <tr class="hover:bg-blue-50/50 transition-colors border-b border-gray-100">
                    <td class="p-3 font-bold text-gray-800 sticky left-0 bg-white z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
                        <div class="flex items-center gap-2">
                            <button onclick="app.expulsarEstudiante('${m.id}')" class="p-1 text-red-300 hover:text-red-500 hover:bg-red-50 rounded" title="Expulsar Estudiante">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
                            </button>
                            ${eInfo.nombre}
                        </div>
                    </td>
                    <td class="p-3 font-medium text-gray-500 text-xs">${eInfo.carnet}</td>
                    <td class="p-3">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${eInfo.genero === 'Femenino' ? 'bg-pink-100 text-pink-600' : 'bg-blue-100 text-blue-600'}">
                            ${eInfo.genero === 'Femenino' ? 'F' : 'M'}
                        </span>
                    </td>
                    <td class="p-3">
                        ${eInfo.firma ? `<img src="${eInfo.firma}" class="h-8 w-auto mix-blend-multiply opacity-80" alt="Firma">` : '<span class="text-[9px] text-gray-300">Sin firma</span>'}
                    </td>
                    <td class="p-3 text-center">
                        <span class="font-black ${pct < 75 ? 'text-red-500' : 'text-green-600'}">${pct}%</span>
                    </td>
            `;

            fechasProg.forEach(f => {
                const asist = asistencias.find(a => a.fecha === f && a.id_clase === idClase && a.id_estudiante === m.id_estudiante);
                const isPresent = !!asist;
                rowHtml += `
                    <td class="p-3 text-center border-l border-gray-100 cursor-pointer hover:bg-white select-none transition-all" 
                        onclick="app.toggleAttendance('${idClase}', '${m.id_estudiante}', '${eInfo.nombre.replace(/'/g, "\\'")}', '${f}', '${isPresent ? 'Presente' : 'Ausente'}')">
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

    expulsarEstudiante: async (solicitudId) => {
        const confirm = await Swal.fire({
            title: '¿Expulsar Estudiante?',
            text: "El estudiante dejará de estar matriculado en esta clase.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'Sí, expulsar'
        });

        if (confirm.isConfirmed) {
            try {
                app.showLoader('Expulsando...');
                await db.collection('inscripciones').doc(solicitudId).delete();
                app.hideLoader();
                app.playSound('success-sound');
            } catch (error) {
                app.hideLoader();
                console.error(error);
                app.alertError('Error', 'No se pudo expulsar al estudiante.');
            }
        }
    },

    exportAuditoriaToExcel: async () => {
        const idClase = document.getElementById('audit-class-select').value;
        if (!idClase) {
            app.alertError('Alerta', 'Seleccione una clase primero.');
            return;
        }

        const { clases, solicitudes, asistencias, estudiantes } = appState.globalData;
        const claseInfo = clases.find(c => c.id === idClase);
        let fechasProg = [];
        try { fechasProg = JSON.parse(claseInfo.FechasPrograma); } catch(e){}
        
        const matriculados = solicitudes.filter(s => s.id_clase === idClase && s.estado === 'Aprobada');
        if(matriculados.length === 0) {
            app.alertError('Alerta', 'No hay estudiantes inscritos.');
            return;
        }

        app.showLoader('Generando Excel Nativos (Puede tardar)...');

        try {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'App Asistencia UNAN';
            const sheetName = claseInfo.Nombre.substring(0, 31).replace(/[\*\?\/\\\[\]]/g, '');
            const sheet = workbook.addWorksheet(sheetName);

            // Construir encabezados
            const baseColumns = [
                { header: 'Estudiante', key: 'estudiante', width: 35 },
                { header: 'Carnet', key: 'carnet', width: 15 },
                { header: 'Género', key: 'genero', width: 10 },
                { header: 'Firma Digital', key: 'firma', width: 30 },
                { header: '%', key: 'pct', width: 8 }
            ];

            fechasProg.forEach(f => {
                baseColumns.push({ header: f, key: `f_${f}`, width: 12 });
            });

            sheet.columns = baseColumns;

            // Formato cabeceras
            const headerRow = sheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002157' } };
            headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

            let currentRowIdx = 2; // Empezamos en la fila 2 para datos

            matriculados.forEach(m => {
                const eInfo = estudiantes.find(e => e.id === m.id_estudiante) || { nombre: m.nombre_estudiante, carnet: m.carnet_estudiante, firma: '', genero: 'N/A' };
                
                // Calculamos porcentaje y recolectamos asistencia por fecha
                let numPresentes = 0;
                let hasFirma = false;
                let asistenciasMap = {};

                fechasProg.forEach(f => {
                    const asist = asistencias.find(a => a.fecha === f && a.id_clase === idClase && a.id_estudiante === m.id_estudiante);
                    if (asist && (asist.estado === 'Presente' || asist.hora !== '-')) { 
                        numPresentes++;
                        hasFirma = true;
                        asistenciasMap[`f_${f}`] = 'Presente';
                    } else {
                        asistenciasMap[`f_${f}`] = 'Ausente';
                    }
                });

                const pctNum = fechasProg.length === 0 ? 100 : Math.min(100, Math.round((numPresentes / fechasProg.length) * 100));

                const rowData = {
                    estudiante: eInfo.nombre,
                    carnet: eInfo.carnet,
                    genero: eInfo.genero === 'Femenino' ? 'F' : 'M',
                    firma: '', // Celda de la imagen
                    pct: `${pctNum}%`,
                    ...asistenciasMap
                };
                
                const row = sheet.addRow(rowData);

                // Estilizar fila estática
                row.height = 45; 
                row.alignment = { vertical: 'middle' };
                row.getCell('pct').font = { bold: true, color: { argb: pctNum < 75 ? 'FFEF4444' : 'FF10B981' } };
                row.getCell('pct').alignment = { horizontal: 'center', vertical: 'middle' };
                row.getCell('genero').alignment = { horizontal: 'center', vertical: 'middle' };

                // Estilizar y transformar las celdas de fechas en checks ✔️ / ❌
                fechasProg.forEach(f => {
                    const cel = row.getCell(`f_${f}`);
                    cel.alignment = { horizontal: 'center', vertical: 'middle' };
                    if (cel.value === 'Presente') {
                       cel.font = { color: { argb: 'FF10B981' }, bold: true };
                       cel.value = '✓';
                    } else {
                       cel.font = { color: { argb: 'FFEF4444' }, bold: true };
                       cel.value = '✗';
                    }
                });

                // Insertar imagen en Base64 en la columna [Firma Digital]
                if (hasFirma && eInfo.firma) {
                    try {
                        const imageId = workbook.addImage({
                            base64: eInfo.firma,
                            extension: 'png'
                        });
                        
                        sheet.addImage(imageId, {
                            tl: { col: 3.1, row: currentRowIdx - 0.8 }, // col 3 = Cuarta columna (Base0 = A=0, B=1, C=2, D=3)
                            ext: { width: 120, height: 35 }
                        });
                    } catch(err) { console.error('Error ExcelJS img:', err); }
                }

                currentRowIdx++;
            });

            // Generar y descargar binario directamente
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Auditoria_${claseInfo.Nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            app.hideLoader();
            app.playSound('success-sound');
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Generación fallida', 'Ocurrió un error generando el documento Excel de firmas.');
        }
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

    initEditSignaturePad: () => {
        const canvas = document.getElementById('edit-signature-pad');
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
        document.getElementById('btn-clear-edit-sig').addEventListener('click', app.clearEditSignature);
    },

    clearEditSignature: () => {
        const canvas = document.getElementById('edit-signature-pad');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    },

    getEditSignatureData: () => {
        const canvas = document.getElementById('edit-signature-pad');
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
        const isEmpty = !pixelBuffer.some(color => color !== 0);
        if (isEmpty) return null;
        return canvas.toDataURL();
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

        try {
            app.showLoader('Buscando clase...');
            const snapshot = await db.collection('clases').where('Codigo', '==', code).get();
            
            if (snapshot.empty) {
                app.hideLoader();
                app.alertError('Alerta', 'El código de clase no existe o es incorrecto.');
                return;
            }

            const doc = snapshot.docs[0];
            const clase = doc.data();
            const idClase = doc.id;

            // Verificar si ya tiene solicitud
            const yaInscrito = appState.globalData.solicitudes.some(s => s.id_clase === idClase);
            if (yaInscrito) {
                app.hideLoader();
                app.alertError('Alerta', 'Ya has solicitado unirte a esta clase.');
                return;
            }

            await db.collection('inscripciones').add({
                id_clase: idClase,
                id_estudiante: appState.user.id,
                nombre_estudiante: appState.user.nombre,
                carnet_estudiante: appState.user.carnet,
                nombre_clase: clase.Nombre,
                estado: 'Pendiente',
                fechaSolicitud: firebase.firestore.FieldValue.serverTimestamp()
            });

            app.hideLoader();
            app.alertSuccess('¡Éxito!', 'Solicitud enviada. El docente debe aprobarte.');
            input.value = '';
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error', 'No se pudo procesar la solicitud.');
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
