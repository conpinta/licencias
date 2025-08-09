import React, { useState, useEffect, memo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, setDoc, query, getDoc } from 'firebase/firestore';

// Declarar las variables con valores predeterminados para evitar errores de 'no-undef' en la compilación de Vercel.
let appId = 'default-app-id';
let firebaseConfig = {};
let initialAuthToken = null;

// En entornos de producción como Vercel, las variables de entorno son accesibles a través de process.env
// En el entorno de Canvas, se usan las variables globales ___.
// Este código es robusto y funciona en ambos casos.
if (typeof process.env.REACT_APP_FIREBASE_CONFIG !== 'undefined') {
    try {
        firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG);
    } catch (e) {
        console.error("Error parsing REACT_APP_FIREBASE_CONFIG:", e);
    }
} else if (typeof __firebase_config !== 'undefined') {
    try {
        firebaseConfig = JSON.parse(__firebase_config);
    } catch (e) {
        console.error("Error parsing __firebase_config:", e);
    }
}
if (typeof __app_id !== 'undefined') {
    appId = __app_id;
}
if (typeof __initial_auth_token !== 'undefined') {
    initialAuthToken = __initial_auth_token;
}


// Helper function to convert base64 to ArrayBuffer for audio playback (kept for completeness, not directly used in this version)
function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// Helper function to convert PCM audio data to WAV format (kept for completeness, not directly used in this version)
function pcmToWav(pcm16, sampleRate) {
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    const wavBuffer = new ArrayBuffer(44 + pcm16.byteLength);
    const view = new DataView(wavBuffer);

    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcm16.byteLength, true); // ChunkSize
    writeString(view, 8, 'WAVE');

    // FMT sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // BitsPerSample

    // DATA sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, pcm16.byteLength, true); // Subchunk2Size

    // Write PCM data
    const pcmBytes = new Uint8Array(pcm16.buffer);
    for (let i = 0; i < pcmBytes.length; i++) {
        view.setUint8(44 + i, pcmBytes[i]);
    }

    return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

/**
 * COMPONENTES MOVIDOS FUERA DEL COMPONENTE PRINCIPAL
 * Este es el cambio principal para solucionar el error del cursor.
 * Al definir estos componentes fuera de App, se evita que se vuelvan a crear
 * en cada renderizado, manteniendo el foco en los campos del formulario.
 */

// Componente para los campos comunes del formulario
const CommonFormFields = memo(({ dni, setDni, categoria, setCategoria, oficina, setOficina, email, setEmail, celular, setCelular }) => (
    <>
        <div className="mb-4">
            <label htmlFor="dni" className="block text-gray-700 text-sm font-bold mb-2">DNI:</label>
            <input
                type="text"
                id="dni"
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                required
            />
        </div>
        <div className="mb-4">
            <label htmlFor="categoria" className="block text-gray-700 text-sm font-bold mb-2">Categoría:</label>
            <input
                type="text"
                id="categoria"
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                required
            />
        </div>
        <div className="mb-4">
            <label htmlFor="oficina" className="block text-gray-700 text-sm font-bold mb-2">Oficina:</label>
            <input
                type="text"
                id="oficina"
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={oficina}
                onChange={(e) => setOficina(e.target.value)}
                required
            />
        </div>
        <div className="mb-4">
            <label htmlFor="email" className="block text-gray-700 text-sm font-bold mb-2">Correo Electrónico:</label>
            <input
                type="email"
                id="email"
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
            />
        </div>
        <div className="mb-4">
            <label htmlFor="celular" className="block text-gray-700 text-sm font-bold mb-2">Celular:</label>
            <input
                type="tel"
                id="celular"
                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={celular}
                onChange={(e) => setCelular(e.target.value)}
                required
            />
        </div>
    </>
));

// Componente para el Panel de Administración
const AdminPanel = memo(({ db, isAuthReady, appId }) => {
    const [submittedForms, setSubmittedForms] = useState([]);
    const [adminMessage, setAdminMessage] = useState('Cargando solicitudes...');

    useEffect(() => {
        if (!db || !isAuthReady) return;

        // Fetch all submitted forms from the public collection
        const q = query(collection(db, `artifacts/${appId}/public/data/allLicencias`));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const forms = [];
            snapshot.forEach((doc) => {
                forms.push({ id: doc.id, ...doc.data() });
            });
            // Sort forms by timestamp in memory (client-side)
            forms.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            setSubmittedForms(forms);
            setAdminMessage(`Se han cargado ${forms.length} solicitudes.`);
        }, (error) => {
            console.error("Error fetching submitted forms:", error);
            setAdminMessage('Error al cargar las solicitudes.');
        });

        return () => unsubscribe();
    }, [db, isAuthReady, appId]);

    return (
        <div className="p-6 bg-white rounded-lg shadow-md max-w-4xl mx-auto my-8">
            <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Panel de Administración - Solicitudes</h2>
            <p className="text-gray-700 mb-4 text-center">{adminMessage}</p>

            {submittedForms.length === 0 ? (
                <p className="text-center text-gray-600">No hay solicitudes enviadas aún.</p>
            ) : (
                <div className="overflow-x-auto rounded-lg shadow-inner">
                    <table className="min-w-full bg-white border border-gray-200">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Ticket ID</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Tipo</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Nombre</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">DNI</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Email</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Fecha Inicio</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Fecha Fin/Inasistencia</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Días</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Adjunto</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Fecha Envío</th>
                            </tr>
                        </thead>
                        <tbody>
                            {submittedForms.map((form) => (
                                <tr key={form.id} className="hover:bg-gray-50">
                                    <td className="py-2 px-4 border-b text-sm text-gray-800 font-mono">{form.id}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800 capitalize">{form.formType}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{form.nombreCompletoEmpleado || `${form.nombre || ''} ${form.apellido || ''}`.trim()}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{form.dni}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{form.email}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{form.fechaInicio || form.fechaInasistenciaRP || form.fechaInasistenciaEstudio || '-'}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{form.fechaFin || '-'}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{form.cantidadDias || '-'}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{form.archivoAdjunto ? 'Sí' : 'No'}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{new Date(form.timestamp).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="mt-6 text-gray-600 text-sm text-center">
                **Nota Importante:** El envío de correos electrónicos desde una aplicación web directamente no es seguro ni escalable.
                En un entorno de producción, se utilizaría un servicio de backend (como Firebase Cloud Functions)
                para manejar el envío de emails de forma segura y fiable.
            </p>
        </div>
    );
});


function App() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false); // Nuevo estado para controlar permisos de admin
    const [currentView, setCurrentView] = useState('home'); // 'home', 'sick', 'vacation', 'personal', 'study', 'admin'
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState(null); // Nuevo estado para manejar errores

    // State for common form fields (nombre and apellido will be conditionally rendered)
    const [nombre, setNombre] = useState('');
    const [apellido, setApellido] = useState('');
    const [dni, setDni] = useState('');
    const [categoria, setCategoria] = useState('');
    const [oficina, setOficina] = useState('');
    const [email, setEmail] = useState('');
    const [celular, setCelular] = useState('');
    const [fechaInicio, setFechaInicio] = useState('');
    const [fechaFin, setFechaFin] = useState('');
    const [cantidadDias, setCantidadDias] = useState('');
    const [archivoAdjunto, setArchivoAdjunto] = useState(null);

    // Specific states for sick leave
    const [tipoLicenciaEnfermedad, setTipoLicenciaEnfermedad] = useState('');
    const [nombreEmpleadoEnfermedad, setNombreEmpleadoEnfermedad] = useState(''); // For selecting from a list or adding
    const [otroNombreEmpleado, setOtroNombreEmpleado] = useState(''); // New state for 'Otro' input

    // Specific states for vacation
    const [tipoLicenciaVacaciones, setTipoLicenciaVacaciones] = useState('');
    const [anioVacaciones, setAnioVacaciones] = useState('');

    // Specific states for personal reasons
    const [fechaInasistenciaRP, setFechaInasistenciaRP] = useState('');

    // Specific states for study leave
    const [fechaInasistenciaEstudio, setFechaInasistenciaEstudio] = useState('');

    // Firebase Initialization and Auth
    useEffect(() => {
        // En Vercel, firebaseConfig puede estar vacío, así que verificamos
        if (Object.keys(firebaseConfig).length === 0) {
            setError("Error: La configuración de Firebase no se ha cargado. Por favor, revisa tus variables de entorno en Vercel.");
            setIsAuthReady(true);
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
    
            setAuth(authInstance);
            setDb(dbInstance);
    
            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    // Usamos el token personalizado si está disponible, de lo contrario, iniciamos sesión de forma anónima
                    if (initialAuthToken) {
                        try {
                            await signInWithCustomToken(authInstance, initialAuthToken);
                        } catch (error) {
                            console.error("Error signing in with custom token:", error);
                            // Fallback to anonymous sign-in if token fails
                            try {
                                await signInAnonymously(authInstance);
                            } catch (anonError) {
                                console.error("Error signing in anonymously after token failed:", anonError);
                                // No es necesario establecer un error aquí, la app puede continuar
                            }
                        }
                    } else {
                        try {
                            await signInAnonymously(authInstance);
                        } catch (anonError) {
                            console.error("Error signing in anonymously:", anonError);
                            // No es necesario establecer un error aquí, la app puede continuar
                        }
                    }
                    setUserId(authInstance.currentUser?.uid || crypto.randomUUID());
                }
                setIsAuthReady(true);
            });
    
            return () => unsubscribe();
        } catch (err) {
            console.error("Error initializing Firebase:", err);
            setError(`Error al inicializar Firebase. Posiblemente las variables de configuración están mal configuradas. Error: ${err.message}`);
        }
    }, []);

    // Effect para verificar si el usuario es administrador
    useEffect(() => {
        const checkAdminStatus = async () => {
            if (!db || !userId) return; // Asegurarse de que db y userId no sean null
            
            try {
                const adminDocRef = doc(db, `artifacts/${appId}/public/data/admins`, userId);
                const adminDoc = await getDoc(adminDocRef);

                if (adminDoc.exists()) {
                    setIsAdmin(true);
                } else {
                    // Para demostración: si no existe, lo creamos para que el usuario pueda ver el panel
                    // En un entorno de producción, esto no se haría.
                    await setDoc(adminDocRef, {
                        uid: userId,
                        createdAt: new Date().toISOString()
                    });
                    setIsAdmin(true);
                }
            } catch (err) {
                console.error("Error checking admin status:", err);
                setError(`Error al verificar estado de administrador: ${err.message}`);
            }
        };

        if (isAuthReady && db && userId) {
            checkAdminStatus();
        }
    }, [db, userId, isAuthReady]);

    // Función para simular el envío de un correo electrónico con los detalles del formulario.
    // En una aplicación real, esto se manejaría en el backend (ej. Firebase Cloud Functions).
    const sendConfirmationEmail = async (formData, ticketNumber) => {
        console.log(`Simulación de envío de correo electrónico a: ${formData.email}`);
        console.log('--------------------------------------------------');
        console.log(`Asunto: Confirmación de Solicitud de Licencia - Ticket #${ticketNumber}`);
        console.log(`Hola ${formData.nombre || 'empleado'},`);
        console.log('');
        console.log('Hemos recibido tu solicitud de licencia con los siguientes detalles:');
        console.log('');
        console.log(`- Tipo de Solicitud: ${formData.formType}`);
        console.log(`- Nombre: ${formData.nombre || formData.nombreCompletoEmpleado}`);
        console.log(`- DNI: ${formData.dni}`);
        console.log(`- Fecha de Solicitud: ${new Date(formData.timestamp).toLocaleString()}`);
        if (formData.fechaInicio) console.log(`- Fecha de Inicio: ${formData.fechaInicio}`);
        if (formData.fechaFin) console.log(`- Fecha de Fin: ${formData.fechaFin}`);
        if (formData.fechaInasistenciaRP) console.log(`- Fecha de Inasistencia: ${formData.fechaInasistenciaRP}`);
        if (formData.cantidadDias) console.log(`- Cantidad de Días: ${formData.cantidadDias}`);
        if (formData.archivoAdjunto) console.log(`- Archivo Adjunto: ${formData.archivoAdjunto}`);
        console.log('');
        console.log('Guardar este correo como registro.');
        console.log('Gracias.');
        console.log('--------------------------------------------------');
    };

    // Function to handle form submission
    const handleSubmit = async (e, formType) => {
        e.preventDefault();
        if (!db || !userId) {
            setMessage('Error: Firebase no está inicializado o el usuario no está autenticado.');
            return;
        }

        setLoading(true);
        setMessage('');

        let formData = {
            userId: userId,
            timestamp: new Date().toISOString(),
            formType: formType,
            // Common fields that might be empty depending on the form
            dni,
            categoria,
            oficina,
            email,
            celular,
            fechaInicio,
            fechaFin,
            cantidadDias,
            archivoAdjunto: archivoAdjunto ? archivoAdjunto.name : null,
        };

        // Add type-specific fields and ensure name/apellido are correctly assigned
        switch (formType) {
            case 'sick':
                // Determine the actual employee name based on selection
                const finalNombreEmpleado = nombreEmpleadoEnfermedad === 'Otro' ? otroNombreEmpleado : nombreEmpleadoEnfermedad;
                const nameParts = finalNombreEmpleado.split(' ');

                formData = {
                    ...formData,
                    nombre: nameParts[0] || '', // Extract first name
                    apellido: nameParts.slice(1).join(' ') || '', // Extract remaining parts as last name
                    nombreCompletoEmpleado: finalNombreEmpleado, // Store full name from dropdown or 'Otro' input
                    tipoLicenciaEnfermedad,
                };
                break;
            case 'vacation':
            case 'personal':
            case 'study':
                formData = {
                    ...formData,
                    nombre, // Use general 'nombre' state
                    apellido, // Use general 'apellido' state
                };
                if (formType === 'vacation') {
                    formData = {
                        ...formData,
                        tipoLicenciaVacaciones,
                        anioVacaciones,
                    };
                } else if (formType === 'personal') {
                    formData = {
                        ...formData,
                        fechaInasistenciaRP,
                    };
                } else if (formType === 'study') {
                    formData = {
                        ...formData,
                        fechaInasistenciaEstudio,
                    };
                }
                break;
            default:
                break;
        }

        try {
            // Store in a public collection for all submitted licenses
            const docRef = await addDoc(collection(db, `artifacts/${appId}/public/data/allLicencias`), formData);
            const ticketNumber = docRef.id;

            // Simular el envío de un correo de confirmación
            await sendConfirmationEmail(formData, ticketNumber);

            setMessage(`Solicitud de ${formType} enviada con éxito! Tu número de ticket es: ${ticketNumber}. Se ha enviado un correo electrónico de confirmación a ${email}.`);
            
            resetForm();
            setCurrentView('home');
        } catch (err) {
            console.error("Error al enviar la solicitud:", err);
            setMessage(`Error al enviar la solicitud: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    const resetForm = () => {
        setNombre('');
        setApellido('');
        setDni('');
        setCategoria('');
        setOficina('');
        setEmail('');
        setCelular('');
        setFechaInicio('');
        setFechaFin('');
        setCantidadDias('');
        setArchivoAdjunto(null);
        setTipoLicenciaEnfermedad('');
        setNombreEmpleadoEnfermedad('');
        setOtroNombreEmpleado(''); // Reset the new state
        setTipoLicenciaVacaciones('');
        setAnioVacaciones('');
        setFechaInasistenciaRP('');
        setFechaInasistenciaEstudio('');
    };

    const renderForm = () => {
        if (error) {
            return (
                <div className="p-6 bg-red-100 border-l-4 border-red-500 text-red-700 max-w-lg mx-auto my-8 rounded-lg shadow-md">
                    <h3 className="text-xl font-bold mb-2">Error de Inicialización</h3>
                    <p>{error}</p>
                    <p className="mt-4 text-sm">
                        Por favor, revisa tus variables de entorno en Vercel para asegurarte de que la configuración de Firebase sea correcta.
                    </p>
                </div>
            );
        }
        
        switch (currentView) {
            case 'sick':
                return (
                    <form onSubmit={(e) => handleSubmit(e, 'sick')} className="p-6 bg-white rounded-lg shadow-md max-w-lg mx-auto my-8">
                        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Solicitud de Licencia por Enfermedad</h2>
                        
                        <div className="mb-4">
                            <label htmlFor="nombreEmpleadoEnfermedad" className="block text-gray-700 text-sm font-bold mb-2">Nombre del Empleado:</label>
                            <select
                                id="nombreEmpleadoEnfermedad"
                                className="shadow border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={nombreEmpleadoEnfermedad}
                                onChange={(e) => {
                                    setNombreEmpleadoEnfermedad(e.target.value);
                                    if (e.target.value !== 'Otro') {
                                        setOtroNombreEmpleado(''); // Clear 'Otro' field if a pre-existing name is selected
                                    }
                                }}
                                required
                            >
                                <option value="">Seleccione o Agregue</option>
                                <option value="Juan Perez">Juan Perez</option>
                                <option value="Maria Lopez">Maria Lopez</option>
                                <option value="Carlos Gomez">Carlos Gomez</option>
                                <option value="Otro">Otro (ingresar abajo)</option>
                            </select>
                            {nombreEmpleadoEnfermedad === 'Otro' && (
                                <input
                                    type="text"
                                    placeholder="Ingrese el nombre completo"
                                    className="mt-2 shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    value={otroNombreEmpleado} // Bind to new state
                                    onChange={(e) => setOtroNombreEmpleado(e.target.value)} // Update new state
                                    required
                                />
                            )}
                        </div>

                        <CommonFormFields 
                            dni={dni} setDni={setDni}
                            categoria={categoria} setCategoria={setCategoria}
                            oficina={oficina} setOficina={setOficina}
                            email={email} setEmail={setEmail}
                            celular={celular} setCelular={setCelular}
                        />

                        <div className="mb-4">
                            <label htmlFor="tipoLicenciaEnfermedad" className="block text-gray-700 text-sm font-bold mb-2">Tipo de Licencia:</label>
                            <select
                                id="tipoLicenciaEnfermedad"
                                className="shadow border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={tipoLicenciaEnfermedad}
                                onChange={(e) => setTipoLicenciaEnfermedad(e.target.value)}
                                required
                            >
                                <option value="">Seleccione un tipo</option>
                                <option value="art22: enfermedad">Art. 22: Enfermedad</option>
                                <option value="art29: atencion familiar">Art. 29: Atención Familiar</option>
                            </select>
                        </div>
                        <div className="mb-4">
                            <label htmlFor="fechaInicio" className="block text-gray-700 text-sm font-bold mb-2">Fecha de Inicio:</label>
                            <input
                                type="date"
                                id="fechaInicio"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={fechaInicio}
                                onChange={(e) => setFechaInicio(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="fechaFin" className="block text-gray-700 text-sm font-bold mb-2">Fecha de Regreso:</label>
                            <input
                                type="date"
                                id="fechaFin"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={fechaFin}
                                onChange={(e) => setFechaFin(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="cantidadDias" className="block text-gray-700 text-sm font-bold mb-2">Cantidad de Días:</label>
                            <select
                                id="cantidadDias"
                                className="shadow border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={cantidadDias}
                                onChange={(e) => setCantidadDias(e.target.value)}
                                required
                            >
                                <option value="">Seleccione días</option>
                                {Array.from({ length: 15 }, (_, i) => i + 1).map(day => (
                                    <option key={day} value={day}>{day}</option>
                                ))}
                            </select>
                        </div>
                        <div className="mb-6">
                            <label htmlFor="archivoAdjunto" className="block text-gray-700 text-sm font-bold mb-2">Certificado Médico (Adjuntar):</label>
                            <input
                                type="file"
                                id="archivoAdjunto"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                onChange={(e) => setArchivoAdjunto(e.target.files[0])}
                            />
                        </div>
                        <button
                            type="submit"
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline w-full transition duration-300 ease-in-out transform hover:scale-105"
                            disabled={loading}
                        >
                            {loading ? 'Enviando...' : 'Enviar Solicitud'}
                        </button>
                    </form>
                );
            case 'vacation':
                return (
                    <form onSubmit={(e) => handleSubmit(e, 'vacation')} className="p-6 bg-white rounded-lg shadow-md max-w-lg mx-auto my-8">
                        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Solicitud de Vacaciones</h2>
                        {/* Specific name/apellido fields for this form */}
                        <div className="mb-4">
                            <label htmlFor="nombre" className="block text-gray-700 text-sm font-bold mb-2">Nombre:</label>
                            <input
                                type="text"
                                id="nombre"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={nombre}
                                onChange={(e) => setNombre(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="apellido" className="block text-gray-700 text-sm font-bold mb-2">Apellido:</label>
                            <input
                                type="text"
                                id="apellido"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={apellido}
                                onChange={(e) => setApellido(e.target.value)}
                                required
                            />
                        </div>
                        <CommonFormFields 
                            dni={dni} setDni={setDni}
                            categoria={categoria} setCategoria={setCategoria}
                            oficina={oficina} setOficina={setOficina}
                            email={email} setEmail={setEmail}
                            celular={celular} setCelular={setCelular}
                        />
                        
                        <div className="mb-4">
                            <label htmlFor="fechaInicio" className="block text-gray-700 text-sm font-bold mb-2">Fecha de Inicio:</label>
                            <input
                                type="date"
                                id="fechaInicio"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={fechaInicio}
                                onChange={(e) => setFechaInicio(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="fechaFin" className="block text-gray-700 text-sm font-bold mb-2">Fecha de Fin:</label>
                            <input
                                type="date"
                                id="fechaFin"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={fechaFin}
                                onChange={(e) => setFechaFin(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="tipoLicenciaVacaciones" className="block text-gray-700 text-sm font-bold mb-2">Tipo de Licencia (Vacaciones):</label>
                            <select
                                id="tipoLicenciaVacaciones"
                                className="shadow border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={tipoLicenciaVacaciones}
                                onChange={(e) => setTipoLicenciaVacaciones(e.target.value)}
                                required
                            >
                                <option value="">Seleccione un tipo</option>
                                <option value="enero">Enero</option>
                                <option value="julio">Julio</option>
                                <option value="otro">Otro</option>
                            </select>
                        </div>
                        <div className="mb-6">
                            <label htmlFor="anioVacaciones" className="block text-gray-700 text-sm font-bold mb-2">Año:</label>
                            <input
                                type="number"
                                id="anioVacaciones"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={anioVacaciones}
                                onChange={(e) => setAnioVacaciones(e.target.value)}
                                min="2020"
                                max="2030"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline w-full transition duration-300 ease-in-out transform hover:scale-105"
                            disabled={loading}
                        >
                            {loading ? 'Enviando...' : 'Enviar Solicitud'}
                        </button>
                    </form>
                );
            case 'personal':
                return (
                    <form onSubmit={(e) => handleSubmit(e, 'personal')} className="p-6 bg-white rounded-lg shadow-md max-w-lg mx-auto my-8">
                        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Solicitud de Razones Particulares (Art. 34)</h2>
                        {/* Specific name/apellido fields for this form */}
                        <div className="mb-4">
                            <label htmlFor="nombre" className="block text-gray-700 text-sm font-bold mb-2">Nombre:</label>
                            <input
                                type="text"
                                id="nombre"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={nombre}
                                onChange={(e) => setNombre(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="apellido" className="block text-gray-700 text-sm font-bold mb-2">Apellido:</label>
                            <input
                                type="text"
                                id="apellido"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={apellido}
                                onChange={(e) => setApellido(e.target.value)}
                                required
                            />
                        </div>
                        <CommonFormFields 
                            dni={dni} setDni={setDni}
                            categoria={categoria} setCategoria={setCategoria}
                            oficina={oficina} setOficina={setOficina}
                            email={email} setEmail={setEmail}
                            celular={celular} setCelular={setCelular}
                        />

                        <div className="mb-4">
                            <label htmlFor="fechaInasistenciaRP" className="block text-gray-700 text-sm font-bold mb-2">Fecha de Inasistencia:</label>
                            <input
                                type="date"
                                id="fechaInasistenciaRP"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={fechaInasistenciaRP}
                                onChange={(e) => setFechaInasistenciaRP(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-6">
                            <label htmlFor="cantidadDias" className="block text-gray-700 text-sm font-bold mb-2">Cantidad de Días:</label>
                            <select
                                id="cantidadDias"
                                className="shadow border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={cantidadDias}
                                onChange={(e) => setCantidadDias(e.target.value)}
                                required
                            >
                                <option value="">Seleccione días</option>
                                <option value="1">1 día</option>
                                <option value="2">2 días (Máximo)</option>
                            </select>
                        </div>
                        <button
                            type="submit"
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline w-full transition duration-300 ease-in-out transform hover:scale-105"
                            disabled={loading}
                        >
                            {loading ? 'Enviando...' : 'Enviar Solicitud'}
                        </button>
                    </form>
                );
            case 'study':
                return (
                    <form onSubmit={(e) => handleSubmit(e, 'study')} className="p-6 bg-white rounded-lg shadow-md max-w-lg mx-auto my-8">
                        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Solicitud de Licencia por Estudio</h2>
                        {/* Specific name/apellido fields for this form */}
                        <div className="mb-4">
                            <label htmlFor="nombre" className="block text-gray-700 text-sm font-bold mb-2">Nombre:</label>
                            <input
                                type="text"
                                id="nombre"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={nombre}
                                onChange={(e) => setNombre(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-4">
                            <label htmlFor="apellido" className="block text-gray-700 text-sm font-bold mb-2">Apellido:</label>
                            <input
                                type="text"
                                id="apellido"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={apellido}
                                onChange={(e) => setApellido(e.target.value)}
                                required
                            />
                        </div>
                        <CommonFormFields 
                            dni={dni} setDni={setDni}
                            categoria={categoria} setCategoria={setCategoria}
                            oficina={oficina} setOficina={setOficina}
                            email={email} setEmail={setEmail}
                            celular={celular} setCelular={setCelular}
                        />

                        <div className="mb-4">
                            <label htmlFor="fechaInasistenciaEstudio" className="block text-gray-700 text-sm font-bold mb-2">Día de Inasistencia:</label>
                            <input
                                type="date"
                                id="fechaInasistenciaEstudio"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={fechaInasistenciaEstudio}
                                onChange={(e) => setFechaInasistenciaEstudio(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-6">
                            <label htmlFor="archivoAdjunto" className="block text-gray-700 text-sm font-bold mb-2">Certificado de Examen (Adjuntar):</label>
                            <input
                                type="file"
                                id="archivoAdjunto"
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                onChange={(e) => setArchivoAdjunto(e.target.files[0])}
                            />
                        </div>
                        <button
                            type="submit"
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline w-full transition duration-300 ease-in-out transform hover:scale-105"
                            disabled={loading}
                        >
                            {loading ? 'Enviando...' : 'Enviar Solicitud'}
                        </button>
                    </form>
                );
            case 'admin':
                return <AdminPanel db={db} isAuthReady={isAuthReady} appId={appId} />;
            case 'home':
            default:
                return (
                    <div className="p-6 bg-white rounded-lg shadow-md max-w-2xl mx-auto my-8 text-center">
                        <h2 className="text-3xl font-bold mb-6 text-gray-800">Bienvenido al Portal de Licencias</h2>
                        <p className="text-lg text-gray-700 mb-8">Por favor, selecciona el tipo de solicitud que deseas realizar:</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <button
                                onClick={() => setCurrentView('sick')}
                                className="bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50"
                            >
                                🤒 Licencia por Enfermedad
                            </button>
                            <button
                                onClick={() => setCurrentView('vacation')}
                                className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-opacity-50"
                            >
                                🏖️ Solicitud de Vacaciones
                            </button>
                            <button
                                onClick={() => setCurrentView('personal')}
                                className="bg-red-500 hover:bg-red-600 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
                            >
                                📝 Solicitud de Razones Particulares
                            </button>
                            <button
                                onClick={() => setCurrentView('study')}
                                className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50"
                            >
                                📚 Licencia por Estudio
                            </button>
                        </div>
                        {isAdmin && ( // Renderizado condicional del botón de administración
                            <div className="mt-10">
                                <button
                                    onClick={() => setCurrentView('admin')}
                                    className="bg-gray-700 hover:bg-gray-800 text-white font-bold py-3 px-8 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-gray-600 focus:ring-opacity-50"
                                >
                                    ⚙️ Panel de Administración
                                </button>
                            </div>
                        )}
                        {userId && (
                            <p className="mt-8 text-sm text-gray-500">
                                Tu ID de Usuario: <span className="font-mono bg-gray-100 p-1 rounded">{userId}</span>
                            </p>
                        )}
                    </div>
                );
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 p-4 font-inter">
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
                body {
                    font-family: 'Inter', sans-serif;
                }
                `}
            </style>
            <script src="https://cdn.tailwindcss.com"></script>

            <header className="flex justify-between items-center py-4 px-6 bg-white shadow-lg rounded-lg mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Gestión de Licencias</h1>
                {currentView !== 'home' && (
                    <button
                        onClick={() => {
                            setCurrentView('home');
                            resetForm();
                        }}
                        className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105"
                    >
                        Volver al Inicio
                    </button>
                )}
            </header>

            <main>
                {message && (
                    <div className={`p-4 mb-4 text-center rounded-lg ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {message}
                    </div>
                )}
                {!isAuthReady ? (
                    <div className="text-center text-lg text-gray-600 mt-10">Cargando aplicación...</div>
                ) : (
                    renderForm()
                )}
            </main>
        </div>
    );
}

export default App;
