/* global XLSX, jspdf */
import React, { useState, useEffect, useRef, memo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, getDoc, deleteDoc, query } from 'firebase/firestore';

// Variables globales para la configuración de Firebase
let appId = 'default-app-id';
let firebaseConfig = {};

// Obtener la configuración de Firebase desde el entorno de Canvas o variables de entorno
if (typeof window !== 'undefined' && typeof window.__firebase_config !== 'undefined') {
    try {
        firebaseConfig = JSON.parse(window.__firebase_config);
    } catch (e) {
        console.error("Error parsing __firebase_config:", e);
    }
} else if (typeof process.env.REACT_APP_FIREBASE_CONFIG !== 'undefined') {
    try {
        firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG);
    } catch (e) {
        console.error("Error parsing REACT_APP_FIREBASE_CONFIG:", e);
    }
}
if (typeof window !== 'undefined' && typeof window.__app_id !== 'undefined') {
    appId = window.__app_id;
}

// Componente para los campos comunes del formulario (memoized para evitar re-renders innecesarios)
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

// Componente para el Panel de Administración (memoized para evitar re-renders innecesarios)
const AdminPanel = memo(({ db, isAuthReady, appId, setMessage, setError }) => {
    const [submittedForms, setSubmittedForms] = useState([]);
    const [adminMessage, setAdminMessage] = useState('Cargando solicitudes...');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [docToDelete, setDocToDelete] = useState(null);
    const [showExportDropdown, setShowExportDropdown] = useState(false);
    const exportDropdownRef = useRef(null);

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

    // Hook para cerrar el dropdown al hacer clic fuera de él
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target)) {
                setShowExportDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [exportDropdownRef]);

    // Función para preparar los datos para la exportación
    const getExportData = () => {
        return submittedForms.map(form => {
            const name = form.nombreCompletoEmpleado || `${form.nombre || ''} ${form.apellido || ''}`.trim();
            const fechaInicioStr = form.fechaInicio || form.fechaInasistenciaRP || form.fechaInasistenciaEstudio || '-';
            const fechaFinStr = form.fechaFin || '-';
            const diasStr = form.cantidadDias || '-';
            const adjuntoStr = form.archivoAdjunto ? 'Sí' : 'No';
            const timestampStr = new Date(form.timestamp).toLocaleString();
            return {
                'Ticket ID': form.id,
                'Tipo': form.formType,
                'Nombre': name,
                'DNI': form.dni,
                'Email': form.email,
                'Celular': form.celular,
                'Fecha Inicio': fechaInicioStr,
                'Fecha Fin': fechaFinStr,
                'Días': diasStr,
                'Adjunto': adjuntoStr,
                'Fecha Envío': timestampStr,
            };
        });
    };

    // Función para exportar los datos a TXT
    const handleExportTxt = () => {
        const data = getExportData();
        const header = Object.keys(data[0]).join('\t');
        const rows = data.map(row => Object.values(row).join('\t')).join('\n');
        
        const fullData = header + '\n' + rows;
        const blob = new Blob([fullData], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `solicitudes_licencias_${new Date().toISOString()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setShowExportDropdown(false);
    };

    // Función para exportar los datos a Excel
    const handleExportExcel = () => {
        if (typeof XLSX === 'undefined') {
            setError("Error: La librería XLSX no está disponible. Intenta refrescar la página.");
            return;
        }

        const data = getExportData();
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Solicitudes");
        XLSX.writeFile(wb, `solicitudes_licencias_${new Date().toISOString()}.xlsx`);
        setShowExportDropdown(false);
    };

    // Función para exportar los datos a PDF
    const handleExportPdf = () => {
        if (typeof jspdf === 'undefined' || typeof jspdf.jsPDF === 'undefined') {
            setError("Error: La librería jsPDF no está disponible. Intenta refrescar la página.");
            return;
        }

        const doc = new jspdf.jsPDF();
        doc.text("Reporte de Solicitudes de Licencias", 14, 15);

        const data = getExportData();
        const columns = Object.keys(data[0]);
        const rows = data.map(row => Object.values(row));

        doc.autoTable({
            startY: 25,
            head: [columns],
            body: rows,
            theme: 'striped',
            styles: { fontSize: 8 },
            headStyles: { fillColor: [52, 73, 94] },
            columnStyles: {
                'Ticket ID': { cellWidth: 20 },
                'Tipo': { cellWidth: 20 },
                'Nombre': { cellWidth: 30 },
                'DNI': { cellWidth: 20 },
                'Email': { cellWidth: 30 },
                'Celular': { cellWidth: 20 },
                'Fecha Envío': { cellWidth: 30 },
            }
        });

        doc.save(`solicitudes_licencias_${new Date().toISOString()}.pdf`);
        setShowExportDropdown(false);
    };

    // Función para enviar WhatsApp
    const handleWhatsApp = (form) => {
        const name = form.nombreCompletoEmpleado || `${form.nombre || ''} ${form.apellido || ''}`.trim();
        const message = `Hola ${name}, te escribimos en relación a tu solicitud de licencia (Ticket #${form.id}).`;
        const whatsappUrl = `https://wa.me/${form.celular}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    };

    // Función para manejar la confirmación de eliminación
    const confirmDelete = (docId) => {
        setDocToDelete(docId);
        setShowDeleteConfirm(true);
    };

    // Función para eliminar un documento de Firestore
    const handleDelete = async () => {
        if (!docToDelete) return;
        
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/public/data/allLicencias`, docToDelete));
            setMessage(`Solicitud #${docToDelete} eliminada con éxito.`);
        } catch (err) {
            console.error("Error deleting document:", err);
            setError(`Error al eliminar la solicitud: ${err.message}`);
        } finally {
            setShowDeleteConfirm(false);
            setDocToDelete(null);
        }
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-md max-w-7xl mx-auto my-8">
            <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Panel de Administración - Solicitudes</h2>
            
            <div className="flex justify-between items-center mb-4">
                <p className="text-gray-700">{adminMessage}</p>
                <div className="relative" ref={exportDropdownRef}>
                    <button
                        onClick={() => setShowExportDropdown(!showExportDropdown)}
                        className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg flex items-center transition duration-300 ease-in-out transform hover:scale-105"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        Exportar
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ml-2 transition-transform duration-200 ${showExportDropdown ? 'rotate-180' : 'rotate-0'}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {showExportDropdown && (
                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10">
                            <button
                                onClick={handleExportTxt}
                                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition duration-150 rounded-t-md"
                            >
                                Exportar a TXT
                            </button>
                            <button
                                onClick={handleExportExcel}
                                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition duration-150"
                            >
                                Exportar a Excel (.xlsx)
                            </button>
                            <button
                                onClick={handleExportPdf}
                                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition duration-150 rounded-b-md"
                            >
                                Exportar a PDF
                            </button>
                        </div>
                    )}
                </div>
            </div>

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
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Celular</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Fecha Envío</th>
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Acciones</th>
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
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{form.celular}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">{new Date(form.timestamp).toLocaleString()}</td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800 space-x-2 flex">
                                        <button
                                            onClick={() => handleWhatsApp(form)}
                                            className="bg-green-500 hover:bg-green-600 text-white p-2 rounded-lg transition duration-300 ease-in-out transform hover:scale-110"
                                            title="Enviar WhatsApp"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor" className="h-4 w-4">
                                                <path d="M380.9 97.1C339.4 55.6 283.4 32 224 32S108.6 55.6 67.1 97.1 32 195.4 32 256c0 52.8 19 102.3 52.6 138.8L32 480l112-32 25.1 7.2c35.8 10.3 73.1 14.8 111.6 14.8 59.4 0 115.4-23.6 156.9-65.1S480 316.6 480 256c0-60.6-23.6-116.6-65.1-158.9zM224 432c-35.8 0-71.1-6.7-103.5-20.1L96 414.8 54.8 480l-20.1-133.5c-37.1-70.1-57.7-151.7-57.7-236.4 0-107 43-205.1 113.8-278.3 69.2-70.8 167.3-114.2 277.2-114.2 110.1 0 208.2 43.4 277.2 114.2 70.8 73.2 113.8 171.3 113.8 278.3 0 107-43 205.1-113.8 278.3-69.2 70.8-167.3 114.2-277.2 114.2-35.8 0-71.1-6.7-103.5-20.1zm-48.4-118.2l-37.8-13.8-19.3 22.8c-2.3 2.7-5.6 4-9.2 4-3.6 0-7-1.3-9.3-4l-15.6-18.4c-2.3-2.7-3.5-6.2-3.5-10.1 0-3.9 1.2-7.4 3.5-10.1l15.6-18.4c2.3-2.7 5.6-4 9.3-4h37.8c3.6 0 7 1.3 9.3 4l19.3 22.8c2.3 2.7 3.5 6.2 3.5 10.1 0 3.9-1.2 7.4-3.5 10.1l-15.6 18.4c-2.3 2.7-5.6 4-9.3 4zM240 313.8l-15.6-18.4c-2.3-2.7-5.6-4-9.3-4-3.6 0-7 1.3-9.3 4l-19.3 22.8c-2.3 2.7-3.5 6.2-3.5 10.1 0 3.9 1.2 7.4 3.5 10.1l15.6 18.4c2.3 2.7 5.6 4 9.3 4h37.8c3.6 0 7-1.3 9.3-4l19.3-22.8c2.3-2.7 3.5-6.2 3.5-10.1 0-3.9-1.2-7.4-3.5-10.1l-15.6-18.4c-2.3-2.7-5.6-4-9.3-4zM304.4 295.4l-15.6 18.4c-2.3 2.7-5.6 4-9.3 4-3.6 0-7-1.3-9.3-4l-19.3-22.8c-2.3-2.7-3.5-6.2-3.5-10.1 0-3.9 1.2-7.4 3.5-10.1l15.6-18.4c2.3-2.7 5.6-4 9.3-4h37.8c3.6 0 7 1.3 9.3 4l19.3 22.8c2.3 2.7 3.5 6.2 3.5 10.1 0 3.9-1.2 7.4-3.5 10.1z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => confirmDelete(form.id)}
                                            className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg transition duration-300 ease-in-out transform hover:scale-110"
                                            title="Eliminar Registro"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                            </svg>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            
            {/* Modal de confirmación de eliminación */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center">
                    <div className="bg-white p-8 rounded-lg shadow-xl max-w-sm w-full text-center">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">¿Estás seguro?</h3>
                        <p className="text-gray-600 mb-6">Esta acción eliminará el registro de forma permanente. No se puede deshacer.</p>
                        <div className="flex justify-center space-x-4">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg transition duration-300"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleDelete}
                                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300"
                            >
                                Eliminar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

// Componente para el formulario de inicio de sesión/registro
const AuthForm = ({ auth, setMessage, setError, setUserId }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegistering, setIsRegistering] = useState(false);
    const [showForgotPassword, setShowForgotPassword] = useState(false); // Nuevo estado para la recuperación

    // Función para manejar el inicio de sesión o registro
    const handleAuth = async (e) => {
        e.preventDefault();
        setMessage('');
        setError(null);
        if (!auth) {
            setError("Error: Firebase Auth no está inicializado.");
            return;
        }

        try {
            if (isRegistering) {
                await createUserWithEmailAndPassword(auth, email, password);
                setMessage('Usuario registrado con éxito. Ahora puedes iniciar sesión.');
                setIsRegistering(false);
            } else {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                setUserId(userCredential.user.uid);
                setMessage('Inicio de sesión exitoso.');
            }
        } catch (err) {
            console.error("Error during authentication:", err);
            setError(`Error de autenticación: ${err.message}`);
        }
    };

    // Función para manejar la recuperación de contraseña
    const handlePasswordReset = async (e) => {
        e.preventDefault();
        setMessage('');
        setError(null);
        if (!auth) {
            setError("Error: Firebase Auth no está inicializado.");
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            setMessage('Se ha enviado un enlace de recuperación de contraseña a tu correo electrónico.');
            setShowForgotPassword(false);
        } catch (err) {
            console.error("Error sending password reset email:", err);
            setError(`Error al enviar el correo: ${err.message}. Asegúrate de que el correo electrónico sea correcto.`);
        }
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-md max-w-sm mx-auto my-8">
            <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">
                {showForgotPassword ? 'Recuperar Contraseña' : (isRegistering ? 'Registrarse' : 'Iniciar Sesión')}
            </h2>

            {showForgotPassword ? (
                // Formulario de recuperación de contraseña
                <form onSubmit={handlePasswordReset}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                            Correo Electrónico
                        </label>
                        <input
                            className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                            id="email"
                            type="email"
                            placeholder="Tu correo electrónico"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="flex items-center justify-between">
                        <button
                            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline w-full transition duration-300 ease-in-out transform hover:scale-105"
                            type="submit"
                        >
                            Enviar Enlace de Recuperación
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowForgotPassword(false)}
                        className="mt-4 w-full text-center text-sm text-gray-600 hover:text-gray-800"
                    >
                        Volver a Iniciar Sesión
                    </button>
                </form>
            ) : (
                // Formulario de inicio de sesión/registro
                <>
                    <div className="flex justify-center mb-4">
                        <button
                            onClick={() => setIsRegistering(false)}
                            className={`px-4 py-2 rounded-l-lg font-bold ${!isRegistering ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                        >
                            Iniciar Sesión
                        </button>
                        <button
                            onClick={() => setIsRegistering(true)}
                            className={`px-4 py-2 rounded-r-lg font-bold ${isRegistering ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                        >
                            Registrarse
                        </button>
                    </div>
                    <form onSubmit={handleAuth}>
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                                Correo Electrónico
                            </label>
                            <input
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-2">
                            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
                                Contraseña
                            </label>
                            <input
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500"
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        <div className="mb-6 text-right">
                            <button
                                type="button"
                                onClick={() => setShowForgotPassword(true)}
                                className="inline-block align-baseline text-sm text-blue-500 hover:text-blue-800"
                            >
                                ¿Olvidaste tu contraseña?
                            </button>
                        </div>
                        <div className="flex items-center justify-between">
                            <button
                                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline w-full transition duration-300 ease-in-out transform hover:scale-105"
                                type="submit"
                            >
                                {isRegistering ? 'Registrarse' : 'Iniciar Sesión'}
                            </button>
                        </div>
                    </form>
                </>
            )}
        </div>
    );
};

// Nuevo componente para la vista de éxito
const SuccessView = ({ submittedFormInfo, resetApp, userId }) => {
    const { formData, ticketNumber } = submittedFormInfo;

    // Función para generar el texto del mensaje para descargar/compartir
    const generateMessageText = () => {
        let message = `*Confirmación de Solicitud de Licencia*\n\n`;
        message += `*Número de Ticket:* ${ticketNumber}\n`;
        message += `*Tipo de Solicitud:* ${formData.formType}\n`;
        message += `*Nombre:* ${formData.nombreCompletoEmpleado || `${formData.nombre || ''} ${formData.apellido || ''}`.trim()}\n`;
        message += `*DNI:* ${formData.dni}\n`;
        message += `*Correo Electrónico:* ${formData.email}\n`;
        message += `*Fecha de Envío:* ${new Date(formData.timestamp).toLocaleString()}\n`;
        
        if (formData.fechaInicio) message += `*Fecha de Inicio:* ${formData.fechaInicio}\n`;
        if (formData.fechaFin) message += `*Fecha de Fin:* ${formData.fechaFin}\n`;
        if (formData.fechaInasistenciaRP) message += `*Fecha de Inasistencia:* ${formData.fechaInasistenciaRP}\n`;
        if (formData.cantidadDias) message += `*Cantidad de Días:* ${formData.cantidadDias}\n`;
        if (formData.archivoAdjunto) message += `*Archivo Adjunto:* ${formData.archivoAdjunto}\n`;
        message += `*ID de Usuario:* ${userId}\n`;
        message += `\nGracias por usar nuestro servicio.\n`;

        return message;
    };

    // Función para descargar el archivo
    const handleDownload = () => {
        const text = generateMessageText();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ticket-${ticketNumber}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Función para compartir por WhatsApp
    const handleWhatsApp = () => {
        const text = generateMessageText();
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(whatsappUrl, '_blank');
    };

    // Función para enviar por correo electrónico
    const handleEmail = () => {
        const subject = encodeURIComponent(`Confirmación de Solicitud de Licencia - Ticket #${ticketNumber}`);
        const body = encodeURIComponent(generateMessageText());
        const emailUrl = `mailto:${formData.email}?subject=${subject}&body=${body}`;
        window.location.href = emailUrl;
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-md max-w-2xl mx-auto my-8 text-center">
            <h2 className="text-3xl font-bold mb-4 text-green-600">¡Solicitud Enviada con Éxito! 🎉</h2>
            <p className="text-lg text-gray-700 mb-6">Tu solicitud ha sido registrada.</p>
            <div className="bg-gray-100 p-6 rounded-lg mb-6 text-left">
                <p className="text-sm text-gray-600 mb-2">Aquí están los detalles de tu solicitud:</p>
                <p className="text-xl font-mono text-gray-800">
                    <span className="font-bold">Número de Ticket:</span> {ticketNumber}
                </p>
                <p className="text-md text-gray-800">
                    <span className="font-bold">Tipo de Solicitud:</span> {formData.formType}
                </p>
                <p className="text-md text-gray-800">
                    <span className="font-bold">Nombre Completo:</span> {formData.nombreCompletoEmpleado || `${formData.nombre || ''} ${formData.apellido || ''}`.trim()}
                </p>
            </div>
            <p className="text-lg text-gray-700 mb-4">Puedes guardar una copia o compartirla:</p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
                <button
                    onClick={handleDownload}
                    className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 flex items-center justify-center"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    Descargar
                </button>
                <button
                    onClick={handleEmail}
                    className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 flex items-center justify-center"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                        <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                    </svg>
                    Enviar por Email
                </button>
                <button
                    onClick={handleWhatsApp}
                    className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 flex items-center justify-center"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor" className="h-5 w-5 mr-2">
                        <path d="M380.9 97.1C339.4 55.6 283.4 32 224 32S108.6 55.6 67.1 97.1 32 195.4 32 256c0 52.8 19 102.3 52.6 138.8L32 480l112-32 25.1 7.2c35.8 10.3 73.1 14.8 111.6 14.8 59.4 0 115.4-23.6 156.9-65.1S480 316.6 480 256c0-60.6-23.6-116.6-65.1-158.9zM224 432c-35.8 0-71.1-6.7-103.5-20.1L96 414.8 54.8 480l-20.1-133.5c-37.1-70.1-57.7-151.7-57.7-236.4 0-107 43-205.1 113.8-278.3 69.2-70.8 167.3-114.2 277.2-114.2 110.1 0 208.2 43.4 277.2 114.2 70.8 73.2 113.8 171.3 113.8 278.3 0 107-43 205.1-113.8 278.3-69.2 70.8-167.3 114.2-277.2 114.2-35.8 0-71.1-6.7-103.5-20.1zm-48.4-118.2l-37.8-13.8-19.3 22.8c-2.3 2.7-5.6 4-9.2 4-3.6 0-7-1.3-9.3-4l-15.6-18.4c-2.3-2.7-3.5-6.2-3.5-10.1 0-3.9 1.2-7.4 3.5-10.1l15.6-18.4c2.3-2.7 5.6-4 9.3-4h37.8c3.6 0 7 1.3 9.3 4l19.3 22.8c2.3 2.7 3.5 6.2 3.5 10.1 0 3.9-1.2 7.4-3.5 10.1l-15.6 18.4c-2.3 2.7-5.6 4-9.3 4zM240 313.8l-15.6-18.4c-2.3-2.7-5.6-4-9.3-4-3.6 0-7 1.3-9.3 4l-19.3 22.8c-2.3 2.7-3.5 6.2-3.5 10.1 0 3.9 1.2 7.4 3.5 10.1l15.6 18.4c2.3 2.7 5.6 4 9.3 4h37.8c3.6 0 7-1.3 9.3-4l19.3-22.8c2.3-2.7 3.5-6.2 3.5-10.1 0-3.9-1.2-7.4-3.5-10.1l-15.6-18.4c-2.3-2.7-5.6-4-9.3-4zM304.4 295.4l-15.6 18.4c-2.3 2.7-5.6 4-9.3 4-3.6 0-7-1.3-9.3-4l-19.3-22.8c-2.3-2.7-3.5-6.2-3.5-10.1 0-3.9 1.2-7.4 3.5-10.1l15.6-18.4c2.3-2.7 5.6-4 9.3-4h37.8c3.6 0 7 1.3 9.3 4l19.3 22.8c2.3 2.7 3.5 6.2 3.5 10.1 0 3.9-1.2 7.4-3.5 10.1z" />
                    </svg>
                    Enviar por WhatsApp
                </button>
            </div>
            <button
                onClick={resetApp}
                className="mt-8 bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105"
            >
                Volver al Menú Principal
            </button>
        </div>
    );
};

function App() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [user, setUser] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [currentView, setCurrentView] = useState('home');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState(null);
    const [submittedFormInfo, setSubmittedFormInfo] = useState(null);

    // State for common form fields
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
    const [nombreEmpleadoEnfermedad, setNombreEmpleadoEnfermedad] = useState('');
    const [otroNombreEmpleado, setOtroNombreEmpleado] = useState('');

    // Specific states for vacation
    const [tipoLicenciaVacaciones, setTipoLicenciaVacaciones] = useState('');
    const [anioVacaciones, setAnioVacaciones] = useState('');

    // Specific states for personal reasons
    const [fechaInasistenciaRP, setFechaInasistenciaRP] = useState('');

    // Specific states for study leave
    const [fechaInasistenciaEstudio, setFechaInasistenciaEstudio] = useState('');

    // Firebase Initialization and Auth
    useEffect(() => {
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

            const unsubscribe = onAuthStateChanged(authInstance, (user) => {
                if (user) {
                    setUser(user);
                    setUserId(user.uid);
                } else {
                    setUser(null);
                    setUserId(null);
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
            if (!db || !userId) {
                setIsAdmin(false);
                return;
            }

            try {
                const adminDocRef = doc(db, `artifacts/${appId}/public/data/admins`, userId);
                const adminDoc = await getDoc(adminDocRef);

                if (adminDoc.exists()) {
                    setIsAdmin(true);
                } else {
                    setIsAdmin(false);
                }
            } catch (err) {
                console.error("Error checking admin status:", err);
                setError(`Error al verificar estado de administrador: ${err.message}`);
            }
        };

        if (isAuthReady && db && userId) {
            checkAdminStatus();
        } else {
            setIsAdmin(false);
        }
    }, [db, userId, isAuthReady]);

    const handleLogout = async () => {
        if (auth) {
            try {
                await signOut(auth);
                setMessage("Sesión cerrada correctamente.");
                setCurrentView('home');
            } catch (error) {
                console.error("Error during sign out:", error);
                setError("Error al cerrar sesión.");
            }
        }
    };

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

        switch (formType) {
            case 'sick':
                const finalNombreEmpleado = nombreEmpleadoEnfermedad === 'Otro' ? otroNombreEmpleado : nombreEmpleadoEnfermedad;
                const nameParts = finalNombreEmpleado.split(' ');
                formData = {
                    ...formData,
                    nombre: nameParts[0] || '',
                    apellido: nameParts.slice(1).join(' ') || '',
                    nombreCompletoEmpleado: finalNombreEmpleado,
                    tipoLicenciaEnfermedad,
                };
                break;
            case 'vacation':
            case 'personal':
            case 'study':
                formData = {
                    ...formData,
                    nombre,
                    apellido,
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
            const docRef = await addDoc(collection(db, `artifacts/${appId}/public/data/allLicencias`), formData);
            const ticketNumber = docRef.id;

            // Almacenar la información del formulario para la vista de éxito
            setSubmittedFormInfo({ formData, ticketNumber });
            
            // Cambiar a la vista de éxito
            setCurrentView('success');

            // Limpiar el formulario
            resetForm();
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
        setOtroNombreEmpleado('');
        setTipoLicenciaVacaciones('');
        setAnioVacaciones('');
        setFechaInasistenciaRP('');
        setFechaInasistenciaEstudio('');
    };
    
    // Función para resetear toda la aplicación y volver a la página de inicio
    const resetApp = () => {
        resetForm();
        setSubmittedFormInfo(null);
        setCurrentView('home');
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

        if (!isAuthReady) {
            return <div className="text-center text-lg text-gray-600 mt-10">Cargando aplicación...</div>;
        }

        if (!user) {
            // Si no hay un usuario autenticado, mostramos el formulario de login/registro
            return <AuthForm auth={auth} setMessage={setMessage} setError={setError} setUserId={setUserId} />;
        }
        
        // Renderizar la vista de éxito si existe la información del formulario
        if (currentView === 'success' && submittedFormInfo) {
            return <SuccessView submittedFormInfo={submittedFormInfo} resetApp={resetApp} userId={userId} />;
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
                                        setOtroNombreEmpleado('');
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
                                    value={otroNombreEmpleado}
                                    onChange={(e) => setOtroNombreEmpleado(e.target.value)}
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
                return <AdminPanel db={db} isAuthReady={isAuthReady} appId={appId} setMessage={setMessage} setError={setError} />;
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
                        {isAdmin && (
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
            <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.17.0/xlsx.full.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js"></script>

            <header className="flex justify-between items-center py-4 px-6 bg-white shadow-lg rounded-lg mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Gestión de Licencias</h1>
                {user && (
                    <div className="flex space-x-4">
                        {currentView !== 'home' && currentView !== 'success' && (
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
                        <button
                            onClick={handleLogout}
                            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105"
                        >
                            Cerrar Sesión
                        </button>
                    </div>
                )}
            </header>

            <main>
                {message && (
                    <div className={`p-4 mb-4 text-center rounded-lg ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {message}
                    </div>
                )}
                {renderForm()}
            </main>
        </div>
    );
}

export default App;
