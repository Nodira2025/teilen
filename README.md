# Teilen · consulta y multicotizador

Piloto con ejecución **local y configuración para Netlify**, implementado el 16/10/2026 a partir del PDF del usuario, la conversación compartida y el estudio de los recursos públicos de Chequea. El código de esta aplicación es propio. No hay integración privada bancaria ni aprobación individual. Subir el repositorio no confirma que exista un despliegue público funcionando.

## Desplegar en Netlify

1. Importar el repositorio `Nodira2025/teilen` y seleccionar la rama `main`.
2. Netlify lee `netlify.toml`: comando **`npm run build`**, directorio público **`public`**, funciones **`netlify/functions`** y Node.js **22**. Dejar vacío el directorio base.
3. En las variables de entorno de Netlify, agregar **`TEILEN_ACCESS_PASSWORD`** con una clave aleatoria de **16 a 256 caracteres** y alcance **Functions**, disponible en el contexto que se despliegue. No cargarla en GitHub ni en `netlify.toml`. Volver a desplegar después de cambiarla.
4. Al abrir la web, ingresar esa clave en **Acceso de Teilen**. Sin configurar la clave funcionan el ejemplo ficticio y el comparador; las consultas personales quedan bloqueadas.
5. Verificar `/api/health` (`mode: netlify`, `auth.configured: true`), el inicio/cierre de sesión y el catálogo. La primera consulta personal completa requiere un documento propio o autorizado.

Importar desde GitHub permite desplegar tanto la interfaz como sus funciones; subir solo la carpeta `public` con arrastrar y soltar no instala el servidor. No hace falta una API key del BCRA. No se ejecuta `npm start` en Netlify.

El adaptador usa las mismas validaciones y normalización BCRA del servidor local. En Linux utiliza `fetch` nativo con validación TLS. La sesión se firma en el servidor y se guarda en una cookie HttpOnly, Secure y SameSite Strict, con duración máxima de 8 horas. Cambiar la clave invalida las sesiones existentes; cerrar sesión elimina la cookie de ese navegador. La clave compartida habilita un piloto de equipo: no identifica operadores individuales ni aporta auditoría por usuario. Netlify limita la API a 30 solicitudes por minuto por IP y dominio; su aplicación puede tener una demora breve. La aplicación no registra cuerpos de solicitudes ni guarda informes; los registros de infraestructura dependen de Netlify.

Referencias técnicas: [Netlify Functions](https://docs.netlify.com/build/functions/get-started/), [límites por función](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/).

## Abrir

Requiere Node.js 22 o superior. En Windows utiliza `curl.exe`, incluido en Windows, para conectarse por HTTPS al BCRA. No requiere instalar paquetes para funcionar.

```powershell
cd D:\teilem
npm.cmd start
```

Abrir <http://127.0.0.1:4318/>. También se puede ejecutar `Iniciar Teilen.cmd`. Si el puerto ya está ocupado por esta misma aplicación, abrir la dirección existente. Para detener el servidor iniciado desde una consola: Ctrl+C.

## Uso

1. Ingresar el CUIT/CUIL completo, o el DNI más el prefijo real del CUIL (20, 23, 24 o 27).
2. Cuando se calcula un CUIL, contrastarlo con la constancia del titular y marcar la confirmación. No se puede determinar de forma unívoca un CUIL solamente con un DNI. No hay consultas masivas de prefijos ni un proveedor de identificación contratado.
3. Confirmar que la consulta es propia o está autorizada y presionar **Consultar documento**.
4. Se consultan en paralelo deudas, historial y cheques rechazados del BCRA. Si una fuente falla, queda identificada como no disponible; no se convierte en ausencia de deudas.
5. Se puede copiar un resumen con documento enmascarado o imprimir el informe (el navegador permite guardar como PDF).
6. En **Comparador prendario**, cargar valor, monto y plazo. Por defecto filtra los cuatro bancos confirmados: Supervielle, Galicia, ICBC y Columbia. El filtro puede ampliarse a todas las entidades.

**Ver ejemplo de informe** presenta exclusivamente datos ficticios. No consulta al BCRA ni sustituye respuestas reales.

## Fuentes y límites

- [API Central de Deudores](https://www.bcra.gob.ar/archivos/Catalogo/Content/files/pdf/central-deudores-v1.pdf): CUIT/CUIL, último período informado, historial de hasta 24 meses y cheques. No requiere una API key.
- [API Régimen de Transparencia](https://www.bcra.gob.ar/archivos/Catalogo/Content/files/pdf/regimen-transparencia-v1.pdf): condiciones generales de líneas prendarias. La aplicación descarga el catálogo actual; conserva una caché en memoria por hasta 15 minutos. Cada registro muestra su fecha de información, que puede ser antigua aunque la descarga sea reciente.
- Deudas e historial: importes oficiales en **miles de pesos**, convertidos una sola vez a pesos. Cheques: importes oficiales en **pesos**, sin multiplicación.
- Sin registros no significa deuda cero, no estar en Veraz, identidad verificada ni aprobación. Importes o tasas faltantes se muestran como no informados.
- No se consulta Veraz, Nosis, RENAPER ni un padrón DNI→CUIL. El prefijo no se infiere del género: se solicita el real de la constancia.

## Simulaciones

Solo se estiman productos en pesos a tasa fija, para automotores usados/0 km o líneas por convenio de marca. Las líneas de motos, capital de trabajo, UVA, dólares y tasa variable/mixta se excluyen de la estimación.

La tasa mensual es `(1 + TEA/100)^(1/12) - 1`; la cuota usa sistema francés y el monto solicitado. La cuota y el total base **no incluyen seguros, impuestos ni otros cargos**. No se utiliza la cuota inicial publicada como si fuera una oferta para el cliente. El CFT se muestra como máximo anual de la línea; no se transforma en un CFT personalizado ni se promete que incluya todos los gastos de esta operación.

La compatibilidad solo revisa mínimos/máximos publicados, plazo máximo y porcentaje de tasación. Falta verificar ingresos, edad, residencia, marca, antigüedad del vehículo, relación bancaria, frecuencia de pago y condiciones específicas. No hay motor de aprobación automática. El orden es por CFT publicado, priorizando parámetros compatibles y fechas no antiguas, no una recomendación personal de crédito. Publicaciones de más de 180 días, sin fecha válida o con fecha futura anómala quedan fuera por defecto; ese umbral es una regla de visualización del piloto, no una norma del BCRA.

El CSV reproduce los filtros aplicados, incluye las advertencias y neutraliza fórmulas de hoja de cálculo provenientes de texto externo.

## Bancos confirmados por el usuario

| Entidad | Plataforma informada | Próximo paso |
| --- | --- | --- |
| Supervielle | IuduCarApp | Relevar URL y acceso comercial de Teilen |
| Galicia | Pendiente | Relevar portal/API y acceso comercial |
| ICBC | Pendiente | Relevar portal/API y acceso comercial |
| Columbia | Pendiente | Relevar portal/API y acceso comercial |

Los cuatro figuran en el catálogo público consultado. Sus aprobaciones individuales están **sin conectar**. No se guardaron credenciales ni se accedió a sus portales. Los nombres genéricos de otros bancos enviados antes se conservan como referencias secundarias.

Para continuar: URL de cada plataforma, acceso habilitado para Teilen gestionado por su operador, flujo de una solicitud de prueba, condiciones de uso de la integración, manejo de 2FA y formato de respuesta. No compartir contraseñas por chat. La política de fondos propios también está pendiente. Hasta disponer de esa información no se deben presentar tasas públicas como cotizaciones personalizadas ni implementar aprobaciones ficticias.

## Arquitectura

- `server.mjs`: servidor HTTP y endpoints `/api/lookup`, `/api/products`, `/api/demo`, `/api/health`.
- `lib/identity.mjs`: formato y dígito verificador, consentimiento y confirmación de CUIL calculado.
- `lib/bcra.mjs`: transporte HTTPS, consultas paralelas, aislamiento de errores, normalización y caché exclusiva de tasas públicas.
- `public/`: interfaz adaptable, estados vacíos, informe, comparador, impresión y CSV.
- `tests/`: pruebas con transportes simulados. Los identificadores sintéticos nunca se envían a un proveedor real.

El servidor escucha **solo en 127.0.0.1**, controla Host y Origin, limita el tamaño de solicitudes y el ritmo de consultas, y devuelve `Cache-Control: no-store`. La aplicación no escribe documentos ni informes en archivos, base de datos, historial de URLs ni almacenamiento del navegador. El CUIL llega al BCRA por HTTPS. En Windows, la URL se pasa a curl mediante stdin, sin identificadores en argumentos del proceso. Se mantiene la validación de certificados TLS. El informe permanece en memoria/DOM hasta limpiar, recargar o cerrar la página.

El servidor local conserva su acceso exclusivo desde este equipo. El adaptador Netlify agrega una clave de equipo, pero no usuarios individuales, auditoría productiva ni almacenamiento multiusuario. Tampoco hay retención por operador ni registro durable de autorizaciones; la casilla es una confirmación operativa. No modificar el bind del servidor local para publicarlo: utilizar el adaptador de Netlify.

## Validación

```powershell
npm.cmd test
npm.cmd run check
```

28 pruebas: documentos inválidos, confirmaciones, unidades monetarias, identificación discordante, errores parciales, falsos 404, límites de consulta, aislamiento local, fórmula de cuota, tasas ausentes, filtros de moneda/plazo/fecha, CSV, autenticación de Netlify, sesiones alteradas/vencidas, rotación de clave, solicitudes entre orígenes y errores sin datos sensibles.

Verificación en vivo: catálogo BCRA descargado con 489 líneas y 48 entidades el 16/10/2026. API de deudores respondió al identificador inválido de prueba `00000000000` con HTTP 400; no se consultaron personas reales. La consulta personal completa queda para una prueba autorizada del titular. El BCRA tuvo un timeout durante la prueba; el sistema lo mostró como indisponibilidad y un nuevo intento descargó el catálogo correctamente.

## Investigación con REA

Se ejecutó REA 6.5.0 sobre nueve archivos JavaScript públicos descargados desde la página principal de Chequea. Evidencia local en `research/rea-evidence.json` (aprox. 134 MiB), excluida de control de versiones. La carpeta también contiene el material de referencia y documentación pública descargada.

```powershell
npx.cmd --yes rea-agents@6.5.0 analyze-javascript-application D:/teilem/research/chequea-public --json
```

La inspección del frontend mostró un POST a `/api/chequeo` con un CUIL y un paso de cálculo desde DNI. Esto **no revela el backend privado de Chequea**, no otorga acceso a bases de datos privadas y no resuelve la aprobación bancaria. La aplicación usa directamente las APIs públicas oficiales, sin depender del endpoint de Chequea.

Referencia funcional aportada: `D:/Multicotizador Prendario.pdf`. Objetivos pendientes del PDF: oferta bancaria individual, política de fondos propios, resultados bancarios incrementales, usuarios e historial, integración autorizada por portal/API, placa comercial con condiciones verificadas y despliegue productivo.
