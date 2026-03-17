const GAS_URL = 'https://script.google.com/macros/s/AKfycbLaxUdAFjZjAI6hJRYOST89pZ9ZcIbiB0X6vCCOA9jd3Rli_bTvkwgr8spCB5uYWIh4A/exec';

// ESTADO EN MEMORIA (Requisito: Cero LocalStorage)
const appState = {
    user: null, // { nombre, usuario, carnet, carrera, rol }
    currentRole: null, // 'Estudiante' | 'Maestro'
    classes: [],
    scanner: null
};

// --- CORE APP LOGIC ---
const app = {
    deferredPrompt: null,

    init: () => {
        // Init Signature Pad
        app.initSignaturePad();
        
        // Event Listeners
        document.getElementById('form-login').addEventListener('submit', app.handleLogin);
        document.getElementById('form-register').addEventListener('submit', app.handleRegister);
        document.getElementById('btn-logout').addEventListener('click', app.logout);
        document.getElementById('btn-install').addEventListener('click', app.installPWA);
        
        // Network status listeners
        window.addEventListener('online', app.handleNetworkChange);
        window.addEventListener('offline', app.handleNetworkChange);
        app.handleNetworkChange(); // Initial check on load

        // PWA Install Prompt Listener
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            app.deferredPrompt = e;
            document.getElementById('btn-install').classList.remove('hidden');
        });

        // Registrar Service Worker
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
            nav.classList.add('mt-8'); // push nav down
            app.playSound('error-sound');
            // Toast ligero sin interrumpir
            Swal.fire({
                toast: true, position: 'top-end', icon: 'warning', 
                title: 'Ofline: Esperando conexión', showConfirmButton: false, timer: 3000
            });
        } else {
            banner.classList.add('-translate-y-full');
            nav.classList.remove('mt-8');
            setTimeout(() => banner.classList.add('hidden'), 300);
            // Confirmar reconexión si antes estaba offline (excepto en init)
            if (appState.wasOffline) {
                app.playSound('success-sound');
                Swal.fire({
                    toast: true, position: 'top-end', icon: 'success', 
                    title: '¡Conexión restaurada!', showConfirmButton: false, timer: 3000
                });
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
            setTimeout(() => el.style.display = 'none', 300); // fade out
        });
        
        setTimeout(() => {
            const view = document.getElementById(viewId);
            view.style.display = 'flex';
            setTimeout(() => view.classList.add('active'), 50);
        }, 300);

        // Control de Navbar
        const nav = document.getElementById('main-nav');
        if (viewId === 'view-dashboard-student' || viewId === 'view-dashboard-master') {
            nav.classList.remove('-translate-y-full');
        } else {
            nav.classList.add('-translate-y-full');
        }
    },

    selectRole: (role) => {
        appState.currentRole = role;
        
        // Ajustar Textos
        document.getElementById('login-title').innerText = `Ingreso ${role}`;
        
        // Si es maestro, ocultar registro
        const regContainer = document.getElementById('register-container');
        if (role === 'Maestro') {
            regContainer.style.display = 'none';
        } else {
            regContainer.style.display = 'block';
        }
        
        app.showView('view-login');
    },

    logout: () => {
        appState.user = null;
        appState.currentRole = null;
        appState.classes = [];
        
        if (appState.scanner) {
            app.stopScanner();
        }
        
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
        Swal.fire({ icon: 'success', title, text, timer: 2000, showConfirmButton: false });
    },

    alertError: (title, text) => {
        app.playSound('error-sound');
        Swal.fire({ icon: 'error', title, text });
    },

    // --- API HELPER ---
    apiCall: async (dataBody) => {
        try {
            app.showLoader('Conectando con el servidor...');
            const response = await fetch(GAS_URL, {
                method: 'POST',
                // Enviamos text/plain para evitar problemas de preflight CORS masivos. GAS lo parsea bien.
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(dataBody)
            });
            
            const result = await response.json();
            app.hideLoader();
            return result;
        } catch (error) {
            app.hideLoader();
            console.error(error);
            app.alertError('Error de Conexión', 'El servidor no responde. Verifica tu internet.');
            return { status: 'error', message: 'Error de red' };
        }
    },

    // --- AUTH ---
    handleLogin: async (e) => {
        e.preventDefault();
        const user = document.getElementById('login-user').value.trim();
        const pass = document.getElementById('login-pass').value.trim();
        
        const payload = {
            accion: 'login',
            usuario: user,
            clave: pass,
            rol: appState.currentRole
        };

        const res = await app.apiCall(payload);
        
        if (res.status === 'success') {
            appState.user = res.data; // {nombre, carnet, carrera, rol, usuario}
            // Fallback si la DB no devolvió el usuario enviado:
            appState.user.usuario = appState.user.usuario || user; 
            
            document.getElementById('form-login').reset();
            app.alertSuccess('Bienvenido', `Hola, ${appState.user.nombre}`);
            
            if (appState.currentRole === 'Maestro') {
                app.loadDashboard();
            } else {
                app.loadStudentProfile();
            }
        } else {
            app.alertError('Credenciales Inválidas', res.message || 'Usuario o contraseña incorrectos.');
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
            firma: firmaBase64,
            rol: 'Estudiante'
        };

        const res = await app.apiCall(payload);
        
        if (res.status === 'success') {
            app.alertSuccess('Registro Exitoso', 'Tu cuenta ha sido creada. Ahora puedes iniciar sesión.');
            document.getElementById('form-register').reset();
            app.clearSignature();
            app.showView('view-login');
        } else {
            app.alertError('Error', res.message || 'El usuario ya existe o hubo un error.');
        }
    },

    // --- MÓDULO ESTUDIANTE ---
    loadStudentProfile: () => {
        document.getElementById('student-name').innerText = appState.user.nombre || 'Estudiante';
        document.getElementById('student-carnet').innerText = `Carnet: ${appState.user.carnet || 'N/A'}`;
        document.getElementById('student-carrera').innerText = appState.user.carrera || 'Universidad';
        app.showView('view-dashboard-student');
    },

    startScanner: () => {
        const container = document.getElementById('scanner-container');
        container.classList.remove('hidden');

        const html5QrCode = new Html5Qrcode("reader");
        appState.scanner = html5QrCode;

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        html5QrCode.start({ facingMode: "environment" }, config, async (decodedText) => {
            // Se detectó código
            app.stopScanner();
            app.playSuccessScan();
            
            // Expected QR: "ID_CLASE" o un JSON "{clase: 'ID'}"
            let idClase = decodedText;
            try {
                const parsed = JSON.parse(decodedText);
                if (parsed.clase) idClase = parsed.clase;
            } catch(e) {}

            app.markAttendance(idClase);
        }, (errorMessage) => {
            // Ignorar errores en frame continuo
        }).catch(err => {
            container.classList.add('hidden');
            app.alertError('Cámara No Disponible', 'Ocurrió un error al acceder a la cámara.');
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

    playSuccessScan: () => {
        app.playSound('success-sound');
        if (navigator.vibrate) navigator.vibrate(200);
    },

    markAttendance: async (idClase) => {
        const payload = {
            accion: 'marcarAsistencia',
            id_clase: idClase,
            usuario_estudiante: appState.user.usuario
        };

        const res = await app.apiCall(payload);
        
        if (res.status === 'success') {
            Swal.fire({
                icon: 'success',
                title: '¡Asistencia Registrada!',
                text: 'Tu asistencia ha sido guardada con éxito.',
                confirmButtonColor: '#002157',
                confirmButtonText: 'Genial'
            });
        } else {
            app.alertError('Alerta', res.message || 'No se pudo registrar la asistencia.');
        }
    },

    // --- MÓDULO MAESTRO ---
    switchMasterTab: (tabId) => {
        // Tabs Btn UI
        document.getElementById('tab-btn-dashboard').className = "flex-1 py-2 text-sm rounded-lg transition-all " + (tabId === 'dashboard' ? "font-semibold bg-white shadow-sm text-unan-blue" : "font-medium text-gray-600 hover:text-unan-blue");
        document.getElementById('tab-btn-qr').className = "flex-1 py-2 text-sm rounded-lg transition-all " + (tabId === 'qr' ? "font-semibold bg-white shadow-sm text-unan-blue" : "font-medium text-gray-600 hover:text-unan-blue");
        
        // Tab Content
        document.getElementById('tab-dashboard').style.display = tabId === 'dashboard' ? 'flex' : 'none';
        document.getElementById('tab-qr').style.display = tabId === 'qr' ? 'flex' : 'none';
    },

    loadDashboard: async () => {
        document.getElementById('master-name').innerText = `Profe. ${appState.user.nombre}`;
        app.switchMasterTab('dashboard');
        app.showView('view-dashboard-master');

        const payload = { accion: 'obtenerDashboard' };
        const res = await app.apiCall(payload);
        
        if (res.status === 'success') {
            app.renderDashboard(res.data);
            
            // Poblar Select de clases (Si lo envía el backend)
            if (res.data.clases && res.data.clases.length > 0) {
                appState.classes = res.data.clases;
                const select = document.getElementById('class-select');
                select.innerHTML = '<option value="">Selecciona una clase...</option>';
                appState.classes.forEach(c => {
                    select.innerHTML += `<option value="${c.ID_Clase}">${c.Nombre} (${c.Horario})</option>`;
                });
            }
        } else {
            app.alertError('Error', 'No se pudieron cargar los datos del panel.');
        }
    },

    renderDashboard: (data) => {
        // data.estadisticas = { asistenciaGlobal: 85, totalEstudiantes: 40 }
        // data.alumnos = [{ nombre: 'Juan', usuario: 'juan_p', porcentaje: 80 }, ...]
        
        const stats = data.estadisticas || { asistenciaGlobal: 0, totalEstudiantes: 0 };
        const alumnos = data.alumnos || [];

        document.getElementById('stat-total-students').innerText = stats.totalEstudiantes;
        document.getElementById('stat-avg-attendance').innerText = `${stats.asistenciaGlobal}%`;

        // Render Chart
        const ctx = document.getElementById('attendance-chart').getContext('2d');
        if (appState.chartInstance) appState.chartInstance.destroy();
        
        appState.chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Asistencia', 'Ausencias'],
                datasets: [{
                    data: [stats.asistenciaGlobal, 100 - stats.asistenciaGlobal],
                    backgroundColor: ['#002157', '#e5e7eb'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { display: false }
                }
            }
        });

        // Render Table
        const tbody = document.getElementById('students-table-body');
        tbody.innerHTML = '';
        
        if (alumnos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-gray-400">Sin datos de alumnos</td></tr>';
            return;
        }

        alumnos.forEach(al => {
            const isDanger = al.porcentaje < 75;
            const rowStr = `
                <tr class="transition-colors hover:bg-gray-50">
                    <td class="p-4 ${isDanger ? 'font-semibold text-red-600' : 'text-gray-800'}">${al.nombre}</td>
                    <td class="p-4 text-gray-500">${al.usuario}</td>
                    <td class="p-4 text-right">
                        <span class="px-2 py-1 rounded inline-block text-xs font-bold ${isDanger ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}">
                            ${al.porcentaje}%
                        </span>
                    </td>
                </tr>
            `;
            tbody.innerHTML += rowStr;
        });
    },

    generateQR: () => {
        const select = document.getElementById('class-select');
        const idClase = select.value;
        const nombreClase = select.options[select.selectedIndex].text;

        if (!idClase) {
            app.alertError('Error', 'Debes seleccionar una clase primero.');
            return;
        }

        const qrContainer = document.getElementById('qr-result-container');
        const qrCodeDiv = document.getElementById('qrcode');
        document.getElementById('qr-class-name').innerText = nombreClase;
        
        qrCodeDiv.innerHTML = ''; // Clear prev
        
        new QRCode(qrCodeDiv, {
            text: JSON.stringify({ clase: idClase }),
            width: 200,
            height: 200,
            colorDark : "#002157",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });

        qrContainer.classList.remove('hidden');
        qrContainer.classList.add('flex');
        app.playSound('success-sound');
    },

    // --- SIGNATURE PAD HELPER ---
    initSignaturePad: () => {
        const canvas = document.getElementById('signature-pad');
        const ctx = canvas.getContext('2d');
        let isDrawing = false;

        // Ajustar Canvas para evitar escalado borroso
        const resizeCanvas = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = 128; // 32 Tailwind
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 2;
            ctx.lineCap = "round";
        };
        
        // setTimeout para asegurar que el DOM esté montado
        setTimeout(resizeCanvas, 500);
        window.addEventListener('resize', resizeCanvas);

        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            let x, y;
            if (e.touches && e.touches.length > 0) {
                x = e.touches[0].clientX - rect.left;
                y = e.touches[0].clientY - rect.top;
            } else {
                x = e.clientX - rect.left;
                y = e.clientY - rect.top;
            }
            return { x, y };
        };

        const startDraw = (e) => {
            e.preventDefault();
            isDrawing = true;
            const { x, y } = getPos(e);
            ctx.beginPath();
            ctx.moveTo(x, y);
        };

        const draw = (e) => {
            if (!isDrawing) return;
            e.preventDefault();
            const { x, y } = getPos(e);
            ctx.lineTo(x, y);
            ctx.stroke();
        };

        const stopDraw = () => {
            if (isDrawing) {
                ctx.closePath();
                isDrawing = false;
            }
        };

        // Mouse Events
        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDraw);
        canvas.addEventListener('mouseleave', stopDraw);
        
        // Touch Events
        canvas.addEventListener('touchstart', startDraw, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDraw);

        // btn clear
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
        
        // Validar si el canvas está vacío (No perfecto, pero funcional)
        const pixelBuffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
        const isEmpty = !pixelBuffer.some(color => color !== 0);
        
        if (isEmpty) return null;
        return canvas.toDataURL(); // Base64
    }
};

window.onload = app.init;
