# Agente Investigador TIC

Aplicación Flask para realizar investigaciones sobre Tecnologías de la
Información y las Comunicaciones con búsqueda web, streaming de resultados,
fuentes en vivo y reporte estructurado.

## Funciones

- Validación de especialización: rechaza preguntas fuera del ámbito TIC.
- Streaming del proceso de investigación mediante Server-Sent Events.
- Detección y visualización de fuentes consultadas.
- Reporte final estructurado con hallazgos, comparación, tendencias y conclusiones.
- Botón para detener una investigación en curso.
- Botón para exportar el reporte a PDF desde el diálogo de impresión del navegador.
- Historial local de investigaciones recientes usando `localStorage`.
- Manejo diferenciado de errores de validación, especialización, autenticación, límites y servidor.

## Ejecutar

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Después abre:

```text
http://127.0.0.1:5000
```

Configura antes tu API key y el modelo en `config.py`.

## Archivos principales

- `app.py`: servidor Flask, validación TIC, llamada a OpenAI y streaming SSE.
- `templates/index.html`: interfaz principal.
- `assets/js/app.js`: flujo del cliente, cancelación, errores, historial y exportación PDF.
- `assets/css/styles.css`: estilos visuales y reglas de impresión.
