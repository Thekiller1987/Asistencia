/**
 * BACKEND PWA ASISTENCIA UNAN - FASE 3 (FINAL Y MEGATABLAS)
 * REEMPLAZA TODO TU ARCHIVO Codigo.gs POR ESTE
 */

function doPost(e) {
  var data = e.parameter;
  if(!data.accion && e.postData && e.postData.contents) {
      try { data = JSON.parse(e.postData.contents); } catch(ex) {
         var raw = e.postData.contents; data = {};
         raw.split('&').forEach(function(pair) {
            var parts = pair.split('=');
            if(parts.length == 2) data[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
         });
      }
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetUsuarios = ss.getSheetByName("Usuarios");
  var sheetAsistencia = ss.getSheetByName("Asistencia");
  
  var sheetClases = ss.getSheetByName("Clases");
  if (!sheetClases) {
      sheetClases = ss.insertSheet("Clases");
      sheetClases.appendRow(["ID_Clase", "Nombre_Clase", "Profesor", "Dias_Impartidos", "Estado", "Fechas_Programa"]);
  }

  var sheetInscripciones = ss.getSheetByName("Inscripciones");
  if (!sheetInscripciones) {
      sheetInscripciones = ss.insertSheet("Inscripciones");
      sheetInscripciones.appendRow(["Fecha", "ID_Clase", "Usuario_Estudiante", "Estado"]);
  }

  // 1. LOGIN
  if (data.accion === "login") {
    var registros = sheetUsuarios.getDataRange().getValues();
    for (var i = 1; i < registros.length; i++) {
      if (registros[i][7] == data.usuario && registros[i][8] == data.clave) {
        var dbRol = registros[i][2];
        
        // Validar que no entre a un rol cruzado, exceptuando al Super Admin que puede usar cualquier puerta
        if (dbRol !== "Super Admin" && data.rol && dbRol !== data.rol) {
            return respuesta({ status: "error", message: "Tu rol es " + dbRol + ". Por favor ingresa en el panel correcto." });
        }
        
        return respuesta({ 
          status: "success", 
          data: {
             nombre: registros[i][0], correo: registros[i][1], rol: dbRol, 
             carnet: registros[i][3], carrera: registros[i][4], anio: registros[i][5], usuario: registros[i][7],
             genero: registros[i][9] || "N/A"
          }
        });
      }
    }
    return respuesta({ status: "error", message: "Credenciales incorrectas" });
  }

  // 2. REGISTRO NUEVO ESTUDIANTE
  if (data.accion === "registroNuevo") {
    var registros = sheetUsuarios.getDataRange().getValues();
    for (var i = 1; i < registros.length; i++) {
        if(registros[i][7] == data.usuario) return respuesta({ status: "error", message: "Usuario existente." });
    }
    sheetUsuarios.appendRow([data.nombre, "", "Estudiante", data.carnet, data.carrera, data.anio, data.firma, data.usuario, data.clave, data.genero]);
    return respuesta({ status: "success", message: "Registro exitoso" });
  }

  // 3. REGISTRO NUEVO MAESTRO (SUPER ADMIN)
  if (data.accion === "crearMaestro") {
    var registros = sheetUsuarios.getDataRange().getValues();
    for (var i = 1; i < registros.length; i++) {
        if(registros[i][7] == data.usuario) return respuesta({ status: "error", message: "Usuario existente." });
    }
    // Maestro solo requiere Nombre, Usuario, Clave, Rol
    sheetUsuarios.appendRow([data.nombre, "", "Maestro", "N/A", "N/A", "N/A", "N/A", data.usuario, data.clave, data.genero || "N/A"]);
    return respuesta({ status: "success", message: "Maestro registrado exitosamente" });
  }

  // 4. CREAR NUEVA CLASE CON PROGRAMA SEMANAL (MAESTRO)
  if (data.accion === "crearClase") {
    var idClase = "CL-" + new Date().getTime();
    // Guardamos en Clases (A: ID_Clase, B: Nombre, C: Profesor, D: Horario/Dias, E: Estado, F: Fechas_Programa JSON)
    sheetClases.appendRow([idClase, data.nombre_clase, data.profesor, data.dias, "Activa", data.fechas_programa || "[]"]);
    return respuesta({ status: "success", message: "Clase creada correctamente", id_clase: idClase });
  }

  // 5. ESTUDIANTE SOLICITA UNIRSE
  if (data.accion === "solicitarInscripcion") {
    var inscripciones = sheetInscripciones.getDataRange().getValues();
    for (var i = 1; i < inscripciones.length; i++) {
        if(inscripciones[i][1] == data.id_clase && inscripciones[i][2] == data.usuario_estudiante) {
            return respuesta({ status: "error", message: "Ya enviaste una solicitud para esta clase." });
        }
    }
    sheetInscripciones.appendRow([new Date().toLocaleDateString(), data.id_clase, data.usuario_estudiante, "Pendiente"]);
    return respuesta({ status: "success", message: "Solicitud enviada al maestro." });
  }

  // 6. MAESTRO GESTIONA SOLICITUD
  if (data.accion === "gestionarSolicitud") {
    var inscripcionesRange = sheetInscripciones.getDataRange();
    var inscripciones = inscripcionesRange.getValues();
    for (var i = 1; i < inscripciones.length; i++) {
        if(inscripciones[i][1] == data.id_clase && inscripciones[i][2] == data.usuario_estudiante) {
            sheetInscripciones.getRange(i + 1, 4).setValue(data.nuevo_estado);
            return respuesta({ status: "success", message: "Solicitud " + data.nuevo_estado });
        }
    }
    return respuesta({ status: "error", message: "Solicitud no encontrada." });
  }

  // 7. FINALIZAR CLASE
  if (data.accion === "finalizarClase") {
    var clasesRange = sheetClases.getDataRange();
    var clases = clasesRange.getValues();
    for (var i = 1; i < clases.length; i++) {
        if(clases[i][0] == data.id_clase) {
            sheetClases.getRange(i + 1, 5).setValue("Finalizada"); 
            return respuesta({ status: "success", message: "Clase finalizada." });
        }
    }
    return respuesta({ status: "error", message: "Clase no encontrada." });
  }

  // 8. MARCADO DE ASISTENCIA (QR TIMED)
  if (data.accion === "marcarAsistencia") {
    // Validar token de seguridad del QR (expira en 15 minutos)
    if (!data.token) {
        return respuesta({ status: "error", message: "QR obsoleto o inválido. Pide al maestro que genere uno nuevo."});
    }
    var qrTime = parseInt(data.token);
    var nowTime = new Date().getTime();
    if (nowTime - qrTime > 15 * 60 * 1000) { // 15 minutos límite
         return respuesta({ status: "error", message: "El código QR ha expirado (Pasaron +15 min). Pida al maestro que genere uno nuevo." });
    }

    // Verificar si está matriculado y aprobado
    var estadoInscripcion = null;
    var inscripciones = sheetInscripciones.getDataRange().getValues();
    for (var i = 1; i < inscripciones.length; i++) {
        if(inscripciones[i][1] == data.id_clase && inscripciones[i][2] == data.usuario_estudiante) {
            estadoInscripcion = inscripciones[i][3];
            break;
        }
    }
    
    if(estadoInscripcion === null) {
        return respuesta({ status: "error", message: "No estás matriculado en esta clase.", code: "NOT_ENROLLED" });
    }
    if(estadoInscripcion === "Pendiente") {
        return respuesta({ status: "error", message: "Tu matrícula está PENDIENTE de revisión por el maestro." });
    }
    if(estadoInscripcion === "Rechazado") {
        return respuesta({ status: "error", message: "Tu solicitud para esta clase fue rechazada." });
    }

    var hoy = new Date().toLocaleDateString();
    var asistencias = sheetAsistencia.getDataRange().getValues();
    for(var k = 1; k < asistencias.length; k++) {
        if(asistencias[k][0] == hoy && asistencias[k][1] == data.id_clase && asistencias[k][2] == data.usuario_estudiante) {
             return respuesta({ status: "error", message: "Ya registraste asistencia hoy." });
        }
    }

    sheetAsistencia.appendRow([hoy, data.id_clase, data.usuario_estudiante, "Presente", new Date().toLocaleTimeString()]);
    return respuesta({ status: "success", message: "Asistencia Guardada" });
  }

  // 9. OBTENER DATOS (MAESTRO Y ESTUDIANTE) ACTUALIZADO
  if (data.accion === "obtenerDatosGlobales") {
    var todasAsistencias = sheetAsistencia.getDataRange().getValues();
    var todasClases = sheetClases.getDataRange().getValues();
    var todosUsuarios = sheetUsuarios.getDataRange().getValues();
    var todasInscripciones = sheetInscripciones.getDataRange().getValues();
    
    // Mapear arrays a objetos
    var clasesArr = todasClases.slice(1).map(function(c) {
       return { ID_Clase: c[0], Nombre: c[1], Profesor: c[2], Dias: c[3], Estado: c[4] || "Activa", FechasPrograma: c[5] || "[]" };
    });
    
    var solicitudesArr = todasInscripciones.slice(1).map(function(ins) {
       var userRow = todosUsuarios.find(function(u) { return u[7] == ins[2]; });
       return { 
           Fecha: ins[0], ID_Clase: ins[1], Usuario: ins[2], Estado: ins[3],
           NombreEstudiante: userRow ? userRow[0] : "Desconocido",
           CarnetEstudiante: userRow ? userRow[3] : "N/A"
       };
    });

    var asistenciasArr = todasAsistencias.slice(1).map(function(a) {
       return { Fecha: a[0], ID_Clase: a[1], Usuario: a[2], Estado: a[3], Hora: a[4] };
    });

    // Se extrae la Base64 solo para que el Maestro pueda auditar las firmas en la vista extendida, y el Genero
    var estudiantesArr = todosUsuarios.slice(1).filter(function(u){ return u[2] === "Estudiante" }).map(function(u) {
       return { Nombre: u[0], Usuario: u[7], Carnet: u[3], Firma: u[6], Genero: u[9] || "N/A" };
    });

    return respuesta({ 
      status: "success", 
      data: { clases: clasesArr, solicitudes: solicitudesArr, asistencias: asistenciasArr, estudiantes: estudiantesArr }
    });
  }

  // 10. MODIFICAR ASISTENCIA MANUALMENTE
  if (data.accion === "modificarAsistenciaManual") {
    var asistenciasRange = sheetAsistencia.getDataRange();
    var asistencias = asistenciasRange.getValues();
    var encontrado = false;

    var fechaNormalizada = data.fecha.replace(/^0+/, '').replace(/\/0+/g, '/');

    for (var i = 1; i < asistencias.length; i++) {
        var bdFechaNormalizada = String(asistencias[i][0]).replace(/^0+/, '').replace(/\/0+/g, '/');
        if (asistencias[i][1] == data.id_clase && asistencias[i][2] == data.usuario_estudiante && (asistencias[i][0] == data.fecha || bdFechaNormalizada == fechaNormalizada || String(asistencias[i][0]).indexOf(fechaNormalizada) !== -1)) {
            sheetAsistencia.getRange(i + 1, 4).setValue(data.nuevo_estado);
            sheetAsistencia.getRange(i + 1, 5).setValue(new Date().toLocaleTimeString() + " (Mod.)");
            encontrado = true;
            break;
        }
    }

    if (!encontrado && data.nuevo_estado !== "Ausente") {
        sheetAsistencia.appendRow([data.fecha, data.id_clase, data.usuario_estudiante, data.nuevo_estado, new Date().toLocaleTimeString() + " (Manual)"]);
    }

    return respuesta({ status: "success", message: "Asistencia actualizada correctamente." });
  }

  return respuesta({ status: "error", message: "Acción no válida." });
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
