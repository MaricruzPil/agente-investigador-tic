import json
import os
import re

from flask import Flask, Response, render_template, request, stream_with_context
from openai import OpenAI, OpenAIError


app = Flask(
    __name__,
    static_folder="assets",
    static_url_path="/assets"
)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5")

def crear_cliente_openai():
    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        raise OpenAIError(
            "Falta configurar la variable de entorno OPENAI_API_KEY."
        )

    return OpenAI(api_key=api_key)

PROFUNDIDADES_BUSQUEDA = {
    "rapida": "low",
    "normal": "medium",
    "profunda": "high"
}


@app.route("/")
def inicio():
    return render_template("index.html")


def sse(tipo, datos):
    return (
        f"event: {tipo}\n"
        f"data: {json.dumps(datos, ensure_ascii=False)}\n\n"
    )


def obtener_valor(objeto, atributo, valor_default=None):
    if objeto is None:
        return valor_default

    if isinstance(objeto, dict):
        return objeto.get(atributo, valor_default)

    return getattr(objeto, atributo, valor_default)


def clasificar_alcance_con_ia(client, pregunta):
    respuesta = client.responses.create(
        model=OPENAI_MODEL,
        input=[
            {
                "role": "system",
                "content": (
                    "Determina si una pregunta pertenece al ámbito de las "
                    "Tecnologías de la Información y las Comunicaciones. "
                    "Comprende el contexto, incluso si la pregunta no usa "
                    "palabras técnicas explícitas, contiene errores, usa el "
                    "nombre de un producto o mezcla tecnología con otro tema. "
                    "Responde únicamente un JSON válido con las claves "
                    "es_tic (boolean) y razon (string breve). Considera TIC "
                    "a la informática, software, hardware, programación, "
                    "internet, IA, datos, telecomunicaciones, ciberseguridad "
                    "y herramientas digitales."
                )
            },
            {"role": "user", "content": pregunta}
        ]
    )
    contenido = obtener_valor(respuesta, "output_text", "").strip()
    contenido = re.sub(r"^```(?:json)?\s*|\s*```$", "", contenido).strip()
    resultado = json.loads(contenido)
    return bool(resultado.get("es_tic")), resultado.get("razon", "")


def emitir_fuentes_desde_accion(accion, urls_emitidas):
    if accion is None:
        return []

    nuevas_fuentes = []
    tipo_accion = obtener_valor(accion, "type", "")
    url_directa = obtener_valor(accion, "url")

    if url_directa and url_directa not in urls_emitidas:
        urls_emitidas.add(url_directa)
        nuevas_fuentes.append({
            "titulo": url_directa,
            "url": url_directa,
            "origen": tipo_accion or "web_search"
        })

    sources = obtener_valor(accion, "sources", []) or []

    for source in sources:
        url = obtener_valor(source, "url")

        if url and url not in urls_emitidas:
            urls_emitidas.add(url)
            nuevas_fuentes.append({
                "titulo": url,
                "url": url,
                "origen": "search"
            })

    return nuevas_fuentes


@app.route("/api/investigar", methods=["POST"])
def investigar():
    datos = request.get_json(silent=True) or {}
    pregunta = datos.get("pregunta", "").strip()
    profundidad = datos.get("profundidad", "normal")
    search_context_size = PROFUNDIDADES_BUSQUEDA.get(profundidad, "medium")

    if not pregunta:
        return Response(
            sse("error", {
                "tipo": "validacion",
                "mensaje": "Debes escribir una pregunta de investigación."
            }),
            mimetype="text/event-stream; charset=utf-8",
            status=400
        )

    try:
        cliente_clasificacion = crear_cliente_openai()
        es_tic, _razon = clasificar_alcance_con_ia(
            cliente_clasificacion,
            pregunta
        )
    except (OpenAIError, json.JSONDecodeError, TypeError, ValueError) as error_clasificacion:
        return Response(
            sse("error", {
                "tipo": "servidor",
                "mensaje": "No se pudo analizar el contexto de la pregunta.",
                "detalle": str(error_clasificacion)
            }),
            mimetype="text/event-stream; charset=utf-8",
            status=503
        )

    if not es_tic:
        return Response(
            sse("error", {
                "tipo": "especializacion",
                "mensaje": (
                    "La pregunta no está dentro del tema de Tecnologías de la "
                    "Información (TI). Este agente responde consultas sobre "
                    "IA, redes, ciberseguridad, nube, IoT, software, hardware "
                    "y datos."
                )
            }),
            mimetype="text/event-stream; charset=utf-8",
            status=422
        )

    instrucciones = """
Eres un agente investigador especializado exclusivamente en Tecnologías de la
Información y las Comunicaciones (TIC).

Debes investigar la pregunta del usuario utilizando búsqueda web y varias
fuentes confiables. El tono debe ser claro, profesional y académico, pensado
para estudiantes universitarios.

Si la pregunta se aleja de TIC, tecnología, informática, telecomunicaciones,
software, hardware, redes, ciberseguridad, nube, datos, IoT o inteligencia
artificial, rechaza la consulta de forma breve y amable. No investigues temas
fuera de esa especialización.

Proceso que debes seguir:
1. Analiza la pregunta.
2. Define un plan breve de investigación.
3. Realiza búsquedas web.
4. Consulta varias fuentes.
5. Selecciona la información más relevante.
6. Compara la información obtenida.
7. Identifica coincidencias, diferencias y tendencias.
8. Sintetiza la evidencia.
9. Genera un reporte bien estructurado.

REGLAS IMPORTANTES:
- Escribe TODO en español.
- No inventes datos ni fuentes.
- Utiliza varias fuentes cuando sea posible.
- Prioriza fuentes oficiales, organismos, documentación técnica, universidades
  o medios especializados confiables.
- No agregues una sección manual de URLs al final.
- Las URLs se mostrarán por separado en la interfaz.

FORMATO OBLIGATORIO DE SALIDA:
Debes responder en Markdown usando exactamente esta estructura:

# [Título breve del reporte]

## 1. Pregunta de investigación
[Reformula claramente la pregunta del usuario en 1 párrafo.]

## 2. Plan de investigación
- [Paso 1 del plan]
- [Paso 2 del plan]
- [Paso 3 del plan]
- [Paso 4 del plan]
- [Paso 5 del plan]

## 3. Hallazgos principales

Para cada hallazgo utiliza EXACTAMENTE este formato y coloca cada campo en una
línea independiente:

### Hallazgo 1
**Nombre:** [Nombre breve y claro del hallazgo]
**Descripción:** [Explicación del hallazgo. No incluyas aquí la fuente ni la URL.]
**Fuente:** [Nombre del sitio, institución, empresa u organismo]
**URL:** [URL completa de la fuente principal]

### Hallazgo 2
**Nombre:** [Nombre breve y claro del hallazgo]
**Descripción:** [Explicación del hallazgo. No incluyas aquí la fuente ni la URL.]
**Fuente:** [Nombre del sitio, institución, empresa u organismo]
**URL:** [URL completa de la fuente principal]

### Hallazgo 3
**Nombre:** [Nombre breve y claro del hallazgo]
**Descripción:** [Explicación del hallazgo. No incluyas aquí la fuente ni la URL.]
**Fuente:** [Nombre del sitio, institución, empresa u organismo]
**URL:** [URL completa de la fuente principal]

Incluye más hallazgos si es necesario.

IMPORTANTE PARA HALLAZGOS:
- El nombre debe ser corto: máximo una línea.
- La descripción debe contener solo la explicación.
- La fuente debe contener solo el nombre de la fuente.
- La URL debe contener solo la dirección web.
- No combines Nombre, Descripción, Fuente y URL en una misma línea.

## 4. Comparación de información
Presenta una tabla Markdown con estas columnas exactas:
| Elemento | Descripción | Ventajas | Limitaciones | Escenarios recomendados |

Debes incluir al menos 3 filas cuando la pregunta lo permita.

## 5. Coincidencias y diferencias entre fuentes
### Coincidencias
- [Coincidencia 1]
- [Coincidencia 2]

### Diferencias
- [Diferencia 1]
- [Diferencia 2]

## 6. Tendencias identificadas
- [Tendencia 1]
- [Tendencia 2]
- [Tendencia 3]

## 7. Conclusiones
[Conclusión final en 1 o 2 párrafos.]
"""

    @stream_with_context
    def generar():
        urls_emitidas = set()
        reporte_acumulado = []

        try:
            client = crear_cliente_openai()

            yield sse("estado", {
                "etapa": "analizando",
                "mensaje": "Analizando la pregunta de investigación..."
            })

            stream = client.responses.create(
                model=OPENAI_MODEL,
                tools=[{
                    "type": "web_search",
                    "search_context_size": search_context_size
                }],
                input=[
                    {
                        "role": "system",
                        "content": instrucciones
                    },
                    {
                        "role": "user",
                        "content": pregunta
                    }
                ],
                stream=True
            )

            for event in stream:
                tipo = obtener_valor(event, "type", "")

                if tipo == "response.web_search_call.in_progress":
                    yield sse("estado", {
                        "etapa": "busqueda",
                        "mensaje": "Iniciando una búsqueda en Internet..."
                    })

                elif tipo == "response.web_search_call.searching":
                    yield sse("estado", {
                        "etapa": "busqueda",
                        "mensaje": "Buscando, contrastando y consultando fuentes..."
                    })

                elif tipo == "response.web_search_call.completed":
                    yield sse("estado", {
                        "etapa": "revision",
                        "mensaje": (
                            "Búsqueda completada. Revisando la información "
                            "encontrada..."
                        )
                    })

                elif tipo == "response.output_item.done":
                    item = obtener_valor(event, "item")

                    if obtener_valor(item, "type") == "web_search_call":
                        accion = obtener_valor(item, "action")

                        for fuente in emitir_fuentes_desde_accion(
                            accion,
                            urls_emitidas
                        ):
                            yield sse("fuente", fuente)

                elif tipo == "response.output_text.annotation.added":
                    anotacion = obtener_valor(event, "annotation")

                    if obtener_valor(anotacion, "type") == "url_citation":
                        url = obtener_valor(anotacion, "url")
                        titulo = obtener_valor(
                            anotacion,
                            "title",
                            url or "Fuente consultada"
                        )

                        if url and url not in urls_emitidas:
                            urls_emitidas.add(url)
                            yield sse("fuente", {
                                "titulo": titulo,
                                "url": url,
                                "origen": "cita"
                            })

                elif tipo == "response.output_text.delta":
                    delta = obtener_valor(event, "delta", "")

                    if delta:
                        reporte_acumulado.append(delta)
                        yield sse("texto", {"delta": delta})

                elif tipo == "response.output_text.done":
                    yield sse("estado", {
                        "etapa": "finalizando",
                        "mensaje": "Sintetizando y organizando el reporte final..."
                    })

                elif tipo == "response.completed":
                    yield sse("completado", {
                        "mensaje": "Investigación completada.",
                        "reporte": "".join(reporte_acumulado),
                        "total_fuentes": len(urls_emitidas)
                    })

                elif tipo == "error":
                    mensaje = obtener_valor(
                        event,
                        "message",
                        "OpenAI devolvió un error durante la investigación."
                    )

                    yield sse("error", {
                        "tipo": "openai",
                        "mensaje": mensaje
                    })

        except Exception as error:
            app.logger.exception("Error al realizar la investigación")

            yield sse("error", {
                "tipo": "servidor",
                "mensaje": "Ocurrió un error al realizar la investigación.",
                "detalle": str(error)
            })

    return Response(
        generar(),
        mimetype="text/event-stream; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        threaded=True
    )
