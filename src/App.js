/* global XLSX, jspdf */
import React, { useState, useEffect, useRef, memo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, getDoc, deleteDoc, query } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

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

// Componente para el Panel de Administración
const AdminPanel = memo(({ db, isAuthReady, appId, setMessage, setError }) => {
    const [submittedForms, setSubmittedForms] = useState([]);
    const [adminMessage, setAdminMessage] = useState('Cargando solicitudes...');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [docToDelete, setDocToDelete] = useState(null);
    const [showExportDropdown, setShowExportDropdown] = useState(false);
    const exportDropdownRef = useRef(null);
    
    const [isXLSXLoaded, setIsXLSXLoaded] = useState(false);
    const [isJSPdfLoaded, setIsJSPdfLoaded] = useState(false);
    const [loadingLibraries, setLoadingLibraries] = useState(true);

    useEffect(() => {
        const loadScript = (src, onLoadCallback, onErrorCallback) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = onLoadCallback;
            script.onerror = onErrorCallback;
            document.head.appendChild(script);
            return script;
        };

        const xlsxScript = loadScript(
            "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.17.0/xlsx.full.min.js",
            () => setIsXLSXLoaded(true),
            () => setError("Error al cargar la librería de Excel.")
        );

        const jspdfScript = loadScript(
            "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
            () => {
                loadScript(
                    "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js",
                    () => {
                        setIsJSPdfLoaded(true);
                        setLoadingLibraries(false);
                    },
                    () => setError("Error al cargar la librería autoTable para PDF.")
                );
            },
            () => setError("Error al cargar la librería jsPDF.")
        );

        return () => {
            document.head.removeChild(xlsxScript);
            document.head.removeChild(jspdfScript);
        };
    }, [setError]);

    useEffect(() => {
        if (!db || !isAuthReady) return;

        const q = query(collection(db, `artifacts/${appId}/public/data/allLicencias`));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const forms = [];
            snapshot.forEach((doc) => {
                forms.push({ id: doc.id, ...doc.data() });
            });
            forms.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            setSubmittedForms(forms);
            setAdminMessage(`Se han cargado ${forms.length} solicitudes.`);
        }, (error) => {
            console.error("Error fetching submitted forms:", error);
            setAdminMessage('Error al cargar las solicitudes.');
        });

        return () => unsubscribe();
    }, [db, isAuthReady, appId, setError]);

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
                'URL Adjunto': form.archivoAdjunto || '-',
            };
        });
    };

    const handleExportTxt = () => {
        const data = getExportData();
        if (data.length === 0) {
            setMessage('No hay datos para exportar.');
            return;
        }
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

    const handleExportExcel = () => {
        if (!isXLSXLoaded) {
            setError("Error: La librería XLSX aún no está disponible.");
            return;
        }

        const data = getExportData();
        if (data.length === 0) {
            setMessage('No hay datos para exportar.');
            return;
        }

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Solicitudes");
        XLSX.writeFile(wb, `solicitudes_licencias_${new Date().toISOString()}.xlsx`);
        setShowExportDropdown(false);
    };

    const handleExportPdf = () => {
        if (!isJSPdfLoaded) {
            setError("Error: La librería jsPDF aún no está disponible.");
            return;
        }
        
        const data = getExportData();
        if (data.length === 0) {
            setMessage('No hay datos para exportar.');
            return;
        }

        const { jsPDF } = jspdf;
        const doc = new jsPDF();
        
        doc.text("Reporte de Solicitudes de Licencias", 14, 15);

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

    const handleWhatsApp = (form) => {
        const name = form.nombreCompletoEmpleado || `${form.nombre || ''} ${form.apellido || ''}`.trim();
        const message = `Hola ${name}, te escribimos en relación a tu solicitud de licencia (Ticket #${form.id}).`;
        const whatsappUrl = `https://wa.me/${form.celular}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    };

    const confirmDelete = (docId) => {
        setDocToDelete(docId);
        setShowDeleteConfirm(true);
    };

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
                        disabled={loadingLibraries}
                    >
                        {loadingLibraries ? (
                            <>
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Cargando...
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                                Exportar
                                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ml-2 transition-transform duration-200 ${showExportDropdown ? 'rotate-180' : 'rotate-0'}`} viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </>
                        )}
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
                                className={`block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition duration-150 ${!isXLSXLoaded ? 'opacity-50 cursor-not-allowed' : ''}`}
                                disabled={!isXLSXLoaded}
                            >
                                Exportar a Excel (.xlsx)
                            </button>
                            <button
                                onClick={handleExportPdf}
                                className={`block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition duration-150 rounded-b-md ${!isJSPdfLoaded ? 'opacity-50 cursor-not-allowed' : ''}`}
                                disabled={!isJSPdfLoaded}
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
                                <th className="py-3 px-4 border-b text-left text-sm font-semibold text-gray-700">Adjunto</th>
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
                                    <td className="py-2 px-4 border-b text-sm text-gray-800">
                                        {form.archivoAdjunto ? (
                                            <a href={form.archivoAdjunto} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                                                Ver
                                            </a>
                                        ) : (
                                            'No'
                                        )}
                                    </td>
                                    <td className="py-2 px-4 border-b text-sm text-gray-800 space-x-2 flex">
                                        <button
                                            onClick={() => handleWhatsApp(form)}
                                            className="bg-green-500 hover:bg-green-600 text-white p-2 rounded-lg transition duration-300 ease-in-out transform hover:scale-110"
                                            title="Enviar WhatsApp"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor" className="h-4 w-4">
                                                <path d="M380.9 97.1C339.4 55.6 283.4 32 224 32S108.6 55.6 67.1 97.1 32 195.4 32 256c0 52.8 19 102.3 52.6 138.8L32 480l112-32 25.1 7.2c35.8 10.3 73.1 14.8 111.6 14.8 59.4 0 115.4-23.6 156.9-65.1S480 316.6 480 256c0-60.6-23.6-116.6-65.1-158.9zM224 432c-35.8 0-71.1-6.7-103.5-20.1L96 414.8 54.8 480l-20.1-133.5c-37.1-70.1-57.7-151.7-57.7-236.4 0-107 43-205.1 113.8-278.3 69.2-70.8 167.3-114.2 277.2-114.2 110.1 0 208.2 43.4 277.2 114.2 70.8 73.2 113.8 171.3 113.8 278.3 0 107-43 205.1-113.8 278.3-69.2 70.8-167.3 114.2-277.2 114.2-35.8 0-71.1-6.7-103.5-20.1zm-48.4-118.2l-37.8-13.8-19.3 22.8c-2.3 2.7-5.6 4-9.2 4-3.6 0-7-1.3-9.3-4l-15.6-18.4c-2.3-2.7-3.5-6.2-3.5-10.1 0-3.9 1.2-7.4 3.5-10.1l15.6-18.4c2.3-2.7 5.6-4 9.3-4h37.8c3.6 0 7 1.3 9.3 4l19.3 22.8c2.3 2.7 3.5 6.2 3.5 10.1 0 3.9-1.2 7.4-3.5 10.1l-15.6 18.4c-2.3 2.7-5.6 4-9.3 4zM240 313.8l-15.6-18.4c-2.3-2.7-5.6-4-9.3-4-3.6 0-7 1.3-9.3 4l-19.3 22.8c-2.3 2.7-3.5 6.2-3.5 10.1 0 3.9 1.2 7.4-3.5 10.1l-15.6 18.4c-2.3 2.7-5.6 4-9.3 4zM224 432c-35.8 0-71.1-6.7-103.5-20.1L96 414.8 54.8 480l-20.1-133.5c-37.1-70.1-57.7-151.7-57.7-236.4 0-107 43-205.1 113.8-278.3 69.2-70.8 167.3-114.2 277.2-114.2 110.1 0 208.2 43.4 277.2 114.2 70.8 73.2 113.8 171.3 113.8 278.3 0 107-43 205.1-113.8 278.3-69.2 70.8-167.3 114.2-277.2 114.2-35.8 0-71.1-6.7-103.5-20.1zm-48.4-118.2l-37.8-13.8-19.3 22.8c-2.3 2.7-5.6 4-9.2 4-3.6 0-7-1.3-9.3-4l-15.6-18.4c-2.3-2.7-3.5-6.2-3.5-10.1 0-3.9 1.2-7.4 3.5-10.1l15.6-18.4c2.3-2.7 5.6-4 9.3-4h37.8c3.6 0 7 1.3 9.3 4l19.3 22.8c2.3 2.7 3.5 6.2 3.5 10.1 0 3.9-1.2 7.4-3.5 10.1l-15.6 18.4c-2.3 2.7-5.6 4-9.3 4zM240 313.8l-15.6-18.4c-2.3-2.7-5.6-4-9.3-4-3.6 0-7 1.3-9.3 4l-19.3 22.8c-2.3 2.7-3.5 6.2-3.5 10.1 0 3.9 1.2 7.4-3.5 10.1l-15.6 18.4c-2.3 2.7-5.6 4-9.3 4z" />
                                            </svg>
                                        </button>
                                        <button
                                            onClick={() => confirmDelete(form.id)}
                                            className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg transition duration-300 ease-in-out transform hover:scale-110"
                                            title="Eliminar"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor" className="h-4 w-4">
                                                <path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.7C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z" />
                                            </svg>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg shadow-xl p-8 max-w-sm w-full">
                        <h3 className="text-lg font-bold mb-4">Confirmar Eliminación</h3>
                        <p className="text-gray-700 mb-6">¿Estás seguro de que quieres eliminar esta solicitud de forma permanente?</p>
                        <div className="flex justify-end space-x-4">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
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


// Componente principal de la aplicación
export default function App() {
    const [user, setUser] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLogin, setIsLogin] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [currentView, setCurrentView] = useState('home');

    // Estados para los formularios
    const [dni, setDni] = useState('');
    const [categoria, setCategoria] = useState('');
    const [oficina, setOficina] = useState('');
    const [celular, setCelular] = useState('');
    const [nombreCompletoEmpleado, setNombreCompletoEmpleado] = useState('');

    // Estados para el formulario de Licencia por Estudio
    const [fechaInasistenciaEstudio, setFechaInasistenciaEstudio] = useState('');
    const [cantidadDiasEstudio, setCantidadDiasEstudio] = useState('');
    const [adjuntoEstudio, setAdjuntoEstudio] = useState(null);

    // Estados para el formulario de Licencia por Enfermedad
    const [fechaInicio, setFechaInicio] = useState('');
    const [fechaFin, setFechaFin] = useState('');
    const [adjuntoEnfermedad, setAdjuntoEnfermedad] = useState(null);
    const [diagnostico, setDiagnostico] = useState('');

    // Estados de inicialización de Firebase
    const [firebaseReady, setFirebaseReady] = useState(false);
    const [authReady, setAuthReady] = useState(false);
    const [app, setApp] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [storage, setStorage] = useState(null);

    useEffect(() => {
        try {
            // Variables globales para la configuración de Firebase
            let firebaseConfig = {};
            let appId = 'default-app-id';
            let initialAuthToken = '';

            // Obtener la configuración de Firebase desde el entorno de Canvas o Vercel
            if (typeof window !== 'undefined' && typeof window.__firebase_config !== 'undefined') {
                firebaseConfig = JSON.parse(window.__firebase_config);
            } else if (typeof process !== 'undefined' && process.env.REACT_APP_FIREBASE_CONFIG) {
                firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG);
            }
            if (typeof window !== 'undefined' && typeof window.__app_id !== 'undefined') {
                appId = window.__app_id;
            }
            if (typeof window !== 'undefined' && typeof window.__initial_auth_token !== 'undefined') {
                initialAuthToken = window.__initial_auth_token;
            }

            // Validar que la configuración no esté vacía
            if (Object.keys(firebaseConfig).length === 0) {
                console.error("Firebase config is missing. App cannot be initialized.");
                setError("Error: La configuración de Firebase no se encontró. Revisa tus variables de entorno.");
                return;
            }

            // Inicializar Firebase
            const initializedApp = initializeApp(firebaseConfig);
            const initializedDb = getFirestore(initializedApp);
            const initializedAuth = getAuth(initializedApp);
            const initializedStorage = getStorage(initializedApp);

            setApp(initializedApp);
            setDb(initializedDb);
            setAuth(initializedAuth);
            setStorage(initializedStorage);
            setFirebaseReady(true);

            // Manejar la autenticación inicial
            const unsubscribe = onAuthStateChanged(initializedAuth, (user) => {
                if (user) {
                    setUser(user);
                } else {
                    setUser(null);
                }
                setAuthReady(true);
            });

            // Si hay un token de autenticación personalizado, úsalo
            if (initialAuthToken) {
                signInWithCustomToken(initializedAuth, initialAuthToken).catch((e) => {
                    console.error("Error signing in with custom token:", e);
                    signInAnonymously(initializedAuth);
                });
            } else {
                signInAnonymously(initializedAuth);
            }
            
            return () => unsubscribe();
        } catch (e) {
            console.error("Error during Firebase initialization:", e);
            setError("Error grave en la inicialización de la aplicación. Revisa la consola para más detalles.");
        }
    }, []);


    const handleSubmitWithFile = async (event, formType, file, formData) => {
        event.preventDefault();
        setError('');
        setMessage('');

        if (!user) {
            setError('Error: Usuario no autenticado.');
            return;
        }
        if (!file) {
            setError('Por favor, adjunta un archivo.');
            return;
        }
        if (!storage || !db) {
            setError('Error: Los servicios de Firebase no están disponibles.');
            return;
        }

        try {
            const fileRef = ref(storage, `licencias/${user.uid}/${formType}/${file.name}_${Date.now()}`);
            await uploadBytes(fileRef, file);
            const downloadURL = await getDownloadURL(fileRef);

            const dataToSave = {
                ...formData,
                formType,
                userId: user.uid,
                archivoAdjunto: downloadURL,
                timestamp: new Date().toISOString(),
                nombreCompletoEmpleado: nombreCompletoEmpleado || `${formData.nombre || ''} ${formData.apellido || ''}`.trim(),
            };

            const q = collection(db, `artifacts/${appId}/public/data/allLicencias`);
            await addDoc(q, dataToSave);

            setMessage('¡Formulario enviado con éxito!');
            resetForm();
            setCurrentView('success');

        } catch (e) {
            console.error("Error al subir archivo o enviar formulario: ", e);
            setError(`Error al enviar el formulario: ${e.message}`);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (e) {
            setError('Error al iniciar sesión. Verifica tu email y contraseña.');
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            setMessage('Usuario registrado con éxito. Ahora puedes iniciar sesión.');
            setIsLogin(true);
        } catch (e) {
            setError('Error al registrar. Intenta con un email diferente.');
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
            setCurrentView('home');
            resetForm();
        } catch (e) {
            setError('Error al cerrar sesión.');
        }
    };

    const handlePasswordReset = async () => {
        setError('');
        if (!email) {
            setError('Por favor, introduce tu email para restablecer la contraseña.');
            return;
        }
        try {
            await sendPasswordResetEmail(auth, email);
            setMessage('Se ha enviado un correo electrónico para restablecer tu contraseña.');
        } catch (e) {
            setError('Error al enviar el correo. Verifica que el email sea correcto.');
        }
    };

    const resetForm = () => {
        setDni('');
        setCategoria('');
        setOficina('');
        setEmail('');
        setCelular('');
        setNombreCompletoEmpleado('');
        setFechaInasistenciaEstudio('');
        setCantidadDiasEstudio('');
        setAdjuntoEstudio(null);
        setFechaInicio('');
        setFechaFin('');
        setAdjuntoEnfermedad(null);
        setDiagnostico('');
        setMessage('');
        setError('');
    };

    const renderForm = () => {
        if (!firebaseReady) {
            return <div className="text-center text-gray-500">Cargando la configuración de la aplicación...</div>;
        }
        if (!authReady) {
             return <div className="text-center text-gray-500">Autenticando usuario...</div>;
        }
        if (error && !user) {
            return (
                <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md text-center">
                    <p className="text-red-600 font-semibold">{error}</p>
                    <p className="text-gray-500 mt-4">Por favor, asegúrate de que las variables de entorno de Firebase estén configuradas correctamente.</p>
                </div>
            );
        }

        if (!user) {
            return (
                <div className="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
                    <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">{isLogin ? 'Iniciar Sesión' : 'Registrarse'}</h2>
                    <form onSubmit={isLogin ? handleLogin : handleRegister} className="flex flex-col space-y-4">
                        <input
                            type="email"
                            placeholder="Correo Electrónico"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            required
                        />
                        <input
                            type="password"
                            placeholder="Contraseña"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            required
                        />
                        <button type="submit" className="w-full bg-blue-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-600 transition-colors">
                            {isLogin ? 'Iniciar Sesión' : 'Registrarse'}
                        </button>
                    </form>
                    <div className="mt-4 text-center">
                        <button onClick={() => setIsLogin(!isLogin)} className="text-sm text-blue-500 hover:underline">
                            {isLogin ? '¿No tienes una cuenta? Regístrate' : '¿Ya tienes una cuenta? Inicia sesión'}
                        </button>
                    </div>
                    {isLogin && (
                        <div className="mt-4 text-center">
                            <button onClick={handlePasswordReset} className="text-sm text-blue-500 hover:underline">
                                ¿Olvidaste tu contraseña?
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        switch (currentView) {
            case 'home':
                return (
                    <div className="flex flex-col items-center justify-center space-y-4">
                        <h1 className="text-4xl font-extrabold text-gray-800">Bienvenido</h1>
                        <p className="text-xl text-gray-600 mb-8">Elige una opción para comenzar:</p>
                        <div className="flex space-x-4">
                            <button
                                onClick={() => setCurrentView('enfermedad')}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-full transition-colors shadow-lg"
                            >
                                Licencia por Enfermedad
                            </button>
                            <button
                                onClick={() => setCurrentView('estudio')}
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-full transition-colors shadow-lg"
                            >
                                Licencia por Estudio
                            </button>
                            <button
                                onClick={() => setCurrentView('admin')}
                                className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-full transition-colors shadow-lg"
                            >
                                Panel de Administración
                            </button>
                        </div>
                    </div>
                );

            case 'enfermedad':
                return (
                    <div className="p-8 bg-white rounded-lg shadow-lg w-full max-w-md">
                        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Formulario Licencia por Enfermedad</h2>
                        <form onSubmit={(e) => handleSubmitWithFile(e, 'enfermedad', adjuntoEnfermedad, {
                            dni, categoria, oficina, email, celular, fechaInicio, fechaFin, diagnostico
                        })} className="space-y-4">
                            <CommonFormFields dni={dni} setDni={setDni} categoria={categoria} setCategoria={setCategoria} oficina={oficina} setOficina={setOficina} email={email} setEmail={setEmail} celular={celular} setCelular={setCelular} />
                            <div className="mb-4">
                                <label htmlFor="fechaInicio" className="block text-gray-700 text-sm font-bold mb-2">Fecha de Inicio:</label>
                                <input type="date" id="fechaInicio" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                            </div>
                            <div className="mb-4">
                                <label htmlFor="fechaFin" className="block text-gray-700 text-sm font-bold mb-2">Fecha de Fin:</label>
                                <input type="date" id="fechaFin" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                            </div>
                            <div className="mb-4">
                                <label htmlFor="diagnostico" className="block text-gray-700 text-sm font-bold mb-2">Diagnóstico:</label>
                                <textarea id="diagnostico" value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} rows="3" className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                            </div>
                            <div className="mb-4">
                                <label htmlFor="adjunto" className="block text-gray-700 text-sm font-bold mb-2">Adjuntar Certificado Médico:</label>
                                <input type="file" id="adjunto" onChange={(e) => setAdjuntoEnfermedad(e.target.files[0])} className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                            </div>
                            <button type="submit" className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                Enviar Licencia por Enfermedad
                            </button>
                        </form>
                    </div>
                );

            case 'estudio':
                return (
                    <div className="p-8 bg-white rounded-lg shadow-lg w-full max-w-md">
                        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Formulario Licencia por Estudio</h2>
                        <form onSubmit={(e) => handleSubmitWithFile(e, 'estudio', adjuntoEstudio, {
                            dni, categoria, oficina, email, celular, fechaInasistenciaEstudio, cantidadDiasEstudio
                        })} className="space-y-4">
                            <CommonFormFields dni={dni} setDni={setDni} categoria={categoria} setCategoria={setCategoria} oficina={oficina} setOficina={setOficina} email={email} setEmail={setEmail} celular={celular} setCelular={setCelular} />
                            <div className="mb-4">
                                <label htmlFor="fechaInasistenciaEstudio" className="block text-gray-700 text-sm font-bold mb-2">Fecha de Inasistencia:</label>
                                <input type="date" id="fechaInasistenciaEstudio" value={fechaInasistenciaEstudio} onChange={(e) => setFechaInasistenciaEstudio(e.target.value)} className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                            </div>
                            <div className="mb-4">
                                <label htmlFor="cantidadDiasEstudio" className="block text-gray-700 text-sm font-bold mb-2">Cantidad de Días:</label>
                                <input type="number" id="cantidadDiasEstudio" value={cantidadDiasEstudio} onChange={(e) => setCantidadDiasEstudio(e.target.value)} className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                            </div>
                            <div className="mb-4">
                                <label htmlFor="adjunto" className="block text-gray-700 text-sm font-bold mb-2">Adjuntar Constancia de Examen:</label>
                                <input type="file" id="adjunto" onChange={(e) => setAdjuntoEstudio(e.target.files[0])} className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500" required />
                            </div>
                            <button type="submit" className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                Enviar Licencia por Estudio
                            </button>
                        </form>
                    </div>
                );

            case 'admin':
                return <AdminPanel db={db} isAuthReady={authReady} appId={appId} setMessage={setMessage} setError={setError} />;

            case 'success':
                return (
                    <div className="text-center p-8 bg-white rounded-lg shadow-lg">
                        <h2 className="text-3xl font-bold text-green-600">¡Éxito! 🎉</h2>
                        <p className="text-lg text-gray-700 mt-4">Tu solicitud ha sido enviada correctamente.</p>
                    </div>
                );

            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4 font-sans">
            <header className="w-full max-w-4xl flex justify-between items-center py-4 px-6 bg-white shadow-md rounded-b-lg mb-8">
                <h1 className="text-3xl font-bold text-blue-600">Licencias App</h1>
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
                            Cerrar Sesión</button>
                    </div>
                )}
            </header>

            <main className="flex-grow flex items-center justify-center w-full">
                {message && (
                    <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 p-4 text-center rounded-lg shadow-lg z-50 ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {message}
                    </div>
                )}
                {error && (
                    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 p-4 text-center rounded-lg shadow-lg z-50 bg-red-100 text-red-700">
                        {error}
                    </div>
                )}
                {renderForm()}
            </main>
        </div>
    );
}

