/**
 * BACKEND PWA ASISTENCIA UNAN (VERSIÓN PRO)
 * URL: https://script.google.com/macros/s/AKfycbzjqjL8xc4L71-YEnpcjIhVoivggppjYa-XUiOPuAm4RnalGGXj-83Jiz5GtjODzJbFMA/exec
 */

function doPost(e) {
  // ATENCIÓN: Extraemos desde e.parameter para manejar el envio Form-URL-Encoded (para evitar CORS)
  var data = e.parameter;
  
  // CORS Fallback: Si e.parameter viene vacío (a veces pasa en App Script), parseamos el cuerpo manual
  if(!data.accion && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents); // Caso text/plain
      } catch(ex) {
         var raw = e.postData.contents; // Caso URL-encoded crudo
         data = {};
         raw.split('&').forEach(function(pair) {
            var parts = pair.split('=');
            if(parts.length == 2) {
               data[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
            }
         });
      }
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetUsuarios = ss.getSheetByName("Usuarios");
  var sheetAsistencia = ss.getSheetByName("Asistencia");
  var sheetClases = ss.getSheetByName("Clases");

  // ==========================================
  // 1. LOGIN POR APODO
  // ==========================================
  if (data.accion === "login") {
    var registros = sheetUsuarios.getDataRange().getValues();
    for (var i = 1; i < registros.length; i++) {
        // [7] es Usuario, [8] es Clave
      if (registros[i][7] == data.usuario && registros[i][8] == data.clave) {
        
        // Verificación de rol de seguridad
        if (data.rol && registros[i][2] !== data.rol) {
            return respuesta({ status: "error", message: "El rol seleccionado no coincide con tú cuenta." });
        }

        return respuesta({ 
          status: "success", 
          data: {
             nombre: registros[i][0], 
             correo: registros[i][1],
             rol: registros[i][2], 
             carnet: registros[i][3],
             carrera: registros[i][4],
             anio: registros[i][5],
             usuario: registros[i][7]
          }
        });
      }
    }
    return respuesta({ status: "error", message: "Credenciales incorrectas" });
  }

  // ==========================================
  // 2. REGISTRO NUEVO (ESTUDIANTE)
  // ==========================================
  if (data.accion === "registroNuevo") {
    // Evitar duplicados
    var registros = sheetUsuarios.getDataRange().getValues();
    for (var i = 1; i < registros.length; i++) {
        if(registros[i][7] == data.usuario) {
            return respuesta({ status: "error", message: "El usuario ya existe, intenta con otro." });
        }
    }

    sheetUsuarios.appendRow([
      data.nombre, 
      "", // Correo vacío
      "Estudiante", 
      data.carnet, 
      data.carrera, 
      data.anio, // Frontend envía 'anio'
      data.firma, 
      data.usuario, 
      data.clave // Frontend envía 'clave'
    ]);
    return respuesta({ status: "success", message: "Registro exitoso" });
  }

  // ==========================================
  // 3. MARCADO DE ASISTENCIA (QR)
  // ==========================================
  if (data.accion === "marcarAsistencia") {
    var hoy = new Date().toLocaleDateString();
    
    // Verificación antidoble escaneo
    var asistencias = sheetAsistencia.getDataRange().getValues();
    for(var k = 1; k < asistencias.length; k++) {
        if(asistencias[k][0] == hoy && asistencias[k][1] == data.id_clase && asistencias[k][2] == data.usuario_estudiante) {
             return respuesta({ status: "error", message: "Ya registraste asistencia para esta clase el día de hoy." });
        }
    }

    sheetAsistencia.appendRow([
      hoy, 
      data.id_clase, 
      data.usuario_estudiante, 
      "Presente", 
      new Date().toLocaleTimeString()
    ]);
    return respuesta({ status: "success", message: "Asistencia Guardada" });
  }

  // ==========================================
  // 4. DATOS DEL DASHBOARD MAESTRO
  // ==========================================
  if (data.accion === "obtenerDashboard") {
    var todasAsistencias = sheetAsistencia.getDataRange().getValues();
    var todasClases = sheetClases.getDataRange().getValues();
    var todosUsuarios = sheetUsuarios.getDataRange().getValues();
    
    var estudiantes = todosUsuarios.slice(1).filter(function(u) { return u[2] === "Estudiante"; });
    
    // A. Formatear Clases (A: ID_Clase, B: Nombre, C: Profesor)
    var clasesArr = [];
    for(var j=1; j<todasClases.length; j++) {
       clasesArr.push({
          ID_Clase: todasClases[j][0],
          Nombre: todasClases[j][1],
          Horario: "Activa" 
       });
    }

    // B. Calcular Estadísticas y Alumnos
    var alumnosData = [];
    var totalPorcentajes = 0;

    estudiantes.forEach(function(est) {
       var nom = est[0];
       var usu = est[7]; // Columna Usuario (H)
       
       var records = todasAsistencias.slice(1).filter(function(a) { return a[2] == usu; });
       var presentes = records.filter(function(a) { return a[3] == "Presente"; }).length;
       var totalClasesDadas = records.length; 
       
       var pct = totalClasesDadas === 0 ? 100 : Math.round((presentes / totalClasesDadas) * 100);
       
       alumnosData.push({
          nombre: nom,
          usuario: usu,
          porcentaje: pct
       });
       
       totalPorcentajes += pct;
    });

    var globalPorcentaje = estudiantes.length === 0 ? 0 : Math.round(totalPorcentajes / estudiantes.length);

    return respuesta({ 
      status: "success", 
      data: {
          estadisticas: { asistenciaGlobal: globalPorcentaje, totalEstudiantes: estudiantes.length },
          alumnos: alumnosData,
          clases: clasesArr
      }
    });
  }

  return respuesta({ status: "error", message: "Acción no válida o no recibida." });
}

// ----------------------------------------
// UTILIDADES
// ----------------------------------------

function respuesta(obj) {
  // CORS Implícito y Tipado de Retorno
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ACTIVADOR: Marcar faltas automáticas (Ejecutar diariamente a las 11:50 PM)
function marcarFaltasAutomaticas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetAsis = ss.getSheetByName("Asistencia");
  var usuarios = ss.getSheetByName("Usuarios").getDataRange().getValues();
  var hoy = new Date().toLocaleDateString();
  
  var asistenciasHoy = sheetAsis.getDataRange().getValues().filter(function(r) { return r[0] == hoy; }).map(function(r) { return r[2]; });

  usuarios.forEach(function(u, i) {
    if (i === 0 || u[2] !== "Estudiante") return;
    
    if (asistenciasHoy.indexOf(u[7]) === -1) {
      sheetAsis.appendRow([hoy, "N/A", u[7], "Falta", "23:59:00"]);
    }
  });
}
