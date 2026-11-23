# Reglas Generales del Proyecto

## 1. Delegación de tareas semánticas a un LLM dedicado (Regla Obligatoria)
Siempre que una tarea del pipeline (clasificación de categorías, desambiguación semántica, detección de variantes/sabores o revisión de colisiones ambiguas) sea **ineficiente, frágil o poco exacta** realizarla únicamente desde código Python (regex, trigramas o heurísticas) y requiera comprensión semántica de un modelo LLM dedicado:

1. **No sobre-ingenierizar en Python**: evita añadir listas interminables de excepciones heurísticas cuando el problema es inherentemente semántico o contextual.
2. **Generar un archivo de texto plano perfecto para LLM**: exporta un archivo `.txt` limpio, autocontenido y fácil de copiar o adjuntar (incluyendo instrucciones claras para el LLM, la lista oficial de categorías/etiquetas válidas, formato exacto de respuesta y filas compactas sin ruido ni saltos de línea rotos).
3. **Informar explícitamente al usuario**: indícale qué archivo se generó, cuántos registros contiene y **dile claramente que esa tarea es mejor realizarla a través de un modelo LLM dedicado y no solo con código Python**, explicando cómo reimportar la salida al proyecto.

## 2. Flujo de Datos Local-First (Sin escrituras accidentales en Supabase)
- Toda consolidación, limpieza, deduplicación, filtro de mercado y enriquecimiento debe ejecutarse primero de forma **100% local** sobre SQLite (`etl/data/local_staging.db`) usando copias base inmutables (`etl/data/supabase_snapshot.db` y `etl/data/local_staging_pre_merge.db.bak`).
- Nunca modificar ni sobrescribir directamente las tablas productivas de Supabase sin aprobación explícita del usuario tras validar las métricas locales.
