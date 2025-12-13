import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Content } from "@google/genai";

// --- Types ---

type PlanType = 'free' | 'pro' | 'campus';

interface DocumentFile {
  id: string;
  userId: string;
  name: string;
  type: 'pdf' | 'docx' | 'txt';
  content: string;
  size: number;
  uploadDate: number;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isError?: boolean;
  format?: OutputFormat;
  suggestions?: string[]; // New: Context-aware next steps
}

type OutputFormat = 'auto' | 'report' | 'table' | 'concise' | 'step';

interface User {
  id: string;
  email: string;
  password: string; 
  name: string;
  role: 'user' | 'admin';
  plan: PlanType;
  joinedDate: number;
}

interface ScheduleEvent {
  id: string;
  userId: string;
  title: string;
  date: string;
  type: 'lesson' | 'assessment' | 'task' | 'meeting';
  description?: string;
  startTime?: string;
}

interface RubricConfig {
  assignment: string;
  gradeLevel: string;
  scale: '3' | '4' | '5';
  bloomsLevel: string;
  objectives: string;
  useActiveDoc: boolean;
}

interface LessonConfig {
  templateId: string;
  topic: string;
  gradeLevel: string;
  duration: string;
  objectives: string;
  standards: string;
  useActiveDoc: boolean;
}

interface AssessmentConfig {
  type: 'mixed' | 'mcq' | 'srq' | 'erq';
  topic: string;
  gradeLevel: string;
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
  includeKey: boolean;
  useActiveDoc: boolean;
}

// Global window extensions
declare global {
  interface Window {
    pdfjsLib: any;
    mammoth: any;
    marked: any;
    jspdf: any;
  }
}

// --- Constants ---

const PLAN_LIMITS = {
  free: { maxDocs: 1, maxSizeMB: 5, label: 'Free Tier' },
  pro: { maxDocs: 10, maxSizeMB: 20, label: 'Educator Pro' },
  campus: { maxDocs: 999, maxSizeMB: 50, label: 'Campus Plan' }
};

const MASTER_SYSTEM_INSTRUCTION = `
ROLE: You are "Edtech AI", an elite pedagogical consultant and educational content specialist. 

CORE DIRECTIVES:
1. EDUCATIONAL EXPERTISE: Apply Bloom's Taxonomy, 5E Model, and UbD.
2. CONTEXT AWARENESS: Ground answers in provided source material.
3. FORMATTING: Use bolding, lists, and clear headings.
4. TONE: Professional, encouraging, and academic.
5. SAFETY: Do not generate academic dishonesty content.

SPECIFIC OUTPUT RULES:
- Rubrics: Table format.
- Quizzes: Include answer key.
- Summaries: BLUF method.
`.trim();

const STORAGE_KEYS = {
  USERS: 'edtech_users_v5', 
  SESSION: 'edtech_session_v5',
  PROMPT: 'edtech_prompt_v5', 
  STATS: 'edtech_stats_v5',
  DOCS_PREFIX: 'edtech_docs_v5_', 
  EVENTS_PREFIX: 'edtech_events_v5_',
  CHAT_PREFIX: 'edtech_chat_v5_'
};

const FORMAT_OPTIONS: { id: OutputFormat; label: string; instruction: string }[] = [
  { id: 'auto', label: 'Auto', instruction: "Answer naturally." },
  { id: 'report', label: 'Report', instruction: "Professional report format with H1/H2." },
  { id: 'table', label: 'Table', instruction: "Markdown table format." },
  { id: 'concise', label: 'Concise', instruction: "Brief summary (BLUF)." },
  { id: 'step', label: 'Steps', instruction: "Numbered step-by-step guide." }
];

const LESSON_TEMPLATES = [
  { id: '5e', name: '5E Model' },
  { id: 'direct', name: 'Direct Instruction' },
  { id: 'ubd', name: 'UbD (Backward Design)' }
];

// --- Icons ---
// (Reduced for brevity, same icons as before)
const IconMenu = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>;
const IconClose = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
const IconUpload = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>;
const IconFile = ({ type }: { type: string }) => {
  let c = "text-gray-400";
  if (type === 'pdf') c = "text-red-400";
  if (type === 'docx') c = "text-blue-400";
  return <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${c}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.586l5.414 5.414a1 1 0 01.586 1.414V19a2 2 0 01-2 2z" /></svg>;
};
const IconTrash = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>;
const IconSettings = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>;
const IconLock = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>;
const IconSend = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>;
const IconBot = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
const IconDownload = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
const IconLogout = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" /></svg>;
const IconTable = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7-4h14M4 6h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" /></svg>;
const IconClipboard = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
const IconClipboardCheck = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
const IconCalendar = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const IconChat = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>;
const IconCheck = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>;
const IconInfo = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

// --- API / DATA ABSTRACTION LAYER (Migration Prep) ---
// TODO: Replace these mocks with Supabase client calls.
// e.g., await supabase.from('users').insert(user)
const api = {
    saveUser: async (user: User) => {
        // MOCK: Save to local storage
        const usersStr = localStorage.getItem(STORAGE_KEYS.USERS);
        const users: User[] = usersStr ? JSON.parse(usersStr) : [];
        const index = users.findIndex(u => u.id === user.id || u.email.toLowerCase() === user.email.toLowerCase());
        if (index === -1) users.push(user);
        else users[index] = user;
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
    },
    getUsers: async (): Promise<User[]> => {
        const usersStr = localStorage.getItem(STORAGE_KEYS.USERS);
        return usersStr ? JSON.parse(usersStr) : [];
    },
    saveDoc: async (doc: DocumentFile) => {
        const key = `${STORAGE_KEYS.DOCS_PREFIX}${doc.userId}`;
        const docsStr = localStorage.getItem(key);
        const docs: DocumentFile[] = docsStr ? JSON.parse(docsStr) : [];
        docs.push(doc);
        localStorage.setItem(key, JSON.stringify(docs));
    },
    getDocs: async (userId: string): Promise<DocumentFile[]> => {
        const key = `${STORAGE_KEYS.DOCS_PREFIX}${userId}`;
        const docsStr = localStorage.getItem(key);
        return docsStr ? JSON.parse(docsStr) : [];
    },
    saveChat: async (userId: string, messages: Message[]) => {
         localStorage.setItem(`${STORAGE_KEYS.CHAT_PREFIX}${userId}`, JSON.stringify(messages));
    },
    getChat: async (userId: string): Promise<Message[]> => {
        const str = localStorage.getItem(`${STORAGE_KEYS.CHAT_PREFIX}${userId}`);
        return str ? JSON.parse(str) : [];
    },
    generateAI: async (apiKey: string, prompt: string, sys: string, hist: any[]) => {
        // TODO: Replace with Vercel Function fetch('/api/generate')
        // const res = await fetch('/api/generate', { ... })
        const ai = new GoogleGenAI({ apiKey });
        const contents: Content[] = hist.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));
        contents.push({ role: 'user', parts: [{ text: prompt }] });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: { systemInstruction: sys }
        });
        return response.text || "No response generated.";
    }
};

// --- Helpers ---
const extractTextFromPDF = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  if (!window.pdfjsLib) throw new Error("PDF Library not loaded.");
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map((item: any) => item.str).join(" ") + "\n\n";
  }
  return fullText;
};

const extractTextFromDOCX = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  if (!window.mammoth) throw new Error("DOCX Library not loaded.");
  const result = await window.mammoth.extractRawText({ arrayBuffer: arrayBuffer });
  return result.value;
};

const getApiKey = (): string | undefined => {
    try {
        if (typeof process !== 'undefined' && process.env?.API_KEY) return process.env.API_KEY;
        if ((import.meta as any).env?.VITE_API_KEY) return (import.meta as any).env.VITE_API_KEY;
        return undefined;
    } catch { return undefined; }
};

const handleExportPDF = (content: string, filename: string) => {
    if (!window.jspdf) return alert("PDF generator not loaded.");
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(79, 70, 229); doc.text("Edtech AI", 20, 20);
    doc.setFontSize(10); doc.setTextColor(100); doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 28);
    doc.setFontSize(12); doc.setTextColor(0);
    const splitText = doc.splitTextToSize(content, 170);
    let y = 40;
    for(let i = 0; i < splitText.length; i++) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(splitText[i], 20, y); y += 7;
    }
    doc.save(`${filename}.pdf`);
};

// --- Components ---

const MarkdownContent = ({ content }: { content: string }) => {
  const [html, setHtml] = useState('');
  useEffect(() => {
    if (window.marked) setHtml(window.marked.parse(content));
    else setHtml(content);
  }, [content]);
  return <div className="prose dark:prose-invert max-w-none text-sm leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: html }} />;
};

// --- Terms Modal (Transparency) ---
const TermsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 max-h-[80vh] overflow-y-auto">
                <div className="p-6">
                    <h2 className="text-xl font-bold mb-4 dark:text-white">Terms & AI Transparency</h2>
                    <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
                        <p><strong>AI Usage:</strong> This application uses Google's Gemini models to generate content. While we strive for accuracy, AI can hallucinate. Always review generated content.</p>
                        <p><strong>Data Privacy:</strong> Documents uploaded are processed for text extraction in the browser. In the live version, data is not stored permanently on servers (currently strictly local storage for preview).</p>
                        <p><strong>Responsibility:</strong> You are responsible for the content you generate and distribute to students.</p>
                    </div>
                    <button onClick={onClose} className="mt-6 w-full py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">I Understand</button>
                </div>
            </div>
        </div>
    );
};

// --- Modals (Generators) ---

const GeneratorModal = ({ title, icon, isOpen, onClose, children, onGenerate }: any) => {
    if(!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 flex flex-col">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800 rounded-t-2xl">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        {icon} {title}
                    </h2>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">{children}</div>
                <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-b-2xl flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                    <button onClick={onGenerate} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 shadow-md">Generate</button>
                </div>
            </div>
        </div>
    );
};

// --- Main Chat Interface ---

const ChatInterface = ({ 
    activeDoc, messages, isThinking, onSendMessage, onClearChat, onClearContext, onSuggestionClick 
}: any) => {
    const [input, setInput] = useState('');
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, isThinking]);

    const handleSend = () => { if(input.trim()) { onSendMessage(input); setInput(''); } };
    
    // Auto-scroll fix and mobile padding
    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900 relative">
            <div className="h-14 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 bg-white dark:bg-gray-900 z-10 sticky top-0">
                 <div className="flex items-center gap-2 overflow-hidden">
                     <div className={`w-2 h-2 rounded-full flex-shrink-0 ${activeDoc ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                     <span className="text-sm font-medium text-gray-600 dark:text-gray-300 truncate">
                         {activeDoc ? activeDoc.name : 'General Context'}
                     </span>
                     {activeDoc && <button onClick={onClearContext} className="text-gray-400 hover:text-red-500"><IconClose /></button>}
                 </div>
                 <div className="flex gap-2">
                     <button onClick={() => messages.length && handleExportPDF(messages[messages.length-1].text, "Export")} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><IconDownload /></button>
                     <button onClick={onClearChat} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"><IconTrash /></button>
                 </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
                {!messages.length && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 opacity-50">
                        <IconBot />
                        <p className="mt-2 text-sm">Select a document or start typing.</p>
                    </div>
                )}
                {messages.map((msg: Message) => (
                    <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[90%] md:max-w-[80%] rounded-2xl p-4 shadow-sm ${msg.role === 'user' ? 'bg-primary-600 text-white rounded-br-none' : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-bl-none'}`}>
                            {msg.role === 'model' ? <MarkdownContent content={msg.text} /> : <p className="whitespace-pre-wrap">{msg.text}</p>}
                        </div>
                        {msg.suggestions && msg.suggestions.length > 0 && (
                            <div className="flex gap-2 mt-2 flex-wrap justify-end md:justify-start">
                                {msg.suggestions.map((s, i) => (
                                    <button key={i} onClick={() => onSuggestionClick(s)} className="text-xs bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-3 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors">
                                        ✨ {s}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
                {isThinking && (
                    <div className="flex justify-start"><div className="bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-2xl rounded-bl-none p-4 shadow-sm flex gap-2"><div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-75"></div><div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce delay-150"></div></div></div>
                )}
                <div ref={endRef} />
            </div>

            <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 sticky bottom-0 z-20">
                <div className="relative">
                    <textarea 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                        placeholder="Type a message..."
                        className="w-full pl-4 pr-12 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none resize-none shadow-sm dark:text-white"
                        rows={1}
                    />
                    <button onClick={handleSend} disabled={!input.trim() || isThinking} className="absolute right-2 bottom-2 p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"><IconSend /></button>
                </div>
                <div className="flex gap-2 mt-2 overflow-x-auto scrollbar-hide">
                    {FORMAT_OPTIONS.map(fmt => (
                        <button key={fmt.id} onClick={() => onSendMessage(input || "Generate.", fmt.id)} className="text-xs px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap">{fmt.label}</button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- App Component ---

const App = () => {
    const [user, setUser] = useState<User | null>(null);
    const [view, setView] = useState<'chat' | 'calendar' | 'dashboard'>('dashboard');
    const [docs, setDocs] = useState<DocumentFile[]>([]);
    const [activeDocId, setActiveDocId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [events, setEvents] = useState<ScheduleEvent[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [isSidebarOpen, setSidebarOpen] = useState(false); // Mobile sidebar state

    // Modals
    const [modalState, setModalState] = useState({
        pricing: false, rubric: false, lesson: false, assessment: false, event: false, settings: false, terms: false
    });

    // Configs for generators (simplified for connectivity)
    const [lessonCtx, setLessonCtx] = useState<string>(""); 

    useEffect(() => {
        const init = async () => {
            const sessionStr = localStorage.getItem(STORAGE_KEYS.SESSION);
            if (sessionStr) {
                const u = JSON.parse(sessionStr);
                setUser(u);
                setDocs(await api.getDocs(u.id));
                setEvents(await api.getUsers() as any); // Mock
                setMessages(await api.getChat(u.id));
            }
        };
        init();
    }, []);

    const toggleModal = (key: keyof typeof modalState, val: boolean) => setModalState(prev => ({ ...prev, [key]: val }));

    const handleSendMessage = async (text: string, formatId: OutputFormat = 'auto', opts: { useActiveDoc?: boolean, type?: string } = {}) => {
        if (!user) return;
        const apiKey = getApiKey();
        if (!apiKey) return alert("API Key missing.");

        const newUserMsg: Message = { id: crypto.randomUUID(), role: 'user', text, timestamp: Date.now() };
        const updatedMsgs = [...messages, newUserMsg];
        setMessages(updatedMsgs);
        api.saveChat(user.id, updatedMsgs);
        setIsThinking(true);
        setView('chat'); // Auto-switch to chat

        const activeDoc = docs.find(d => d.id === activeDocId);
        const includeDoc = opts.useActiveDoc !== undefined ? opts.useActiveDoc : !!activeDocId;
        
        let sys = MASTER_SYSTEM_INSTRUCTION;
        if (includeDoc && activeDoc) sys += `\n\n=== CONTEXT: ${activeDoc.name} ===\n${activeDoc.content.substring(0, 30000)}`;
        const fmt = FORMAT_OPTIONS.find(f => f.id === formatId);
        if (fmt) sys += `\n\nFORMAT: ${fmt.instruction}`;

        try {
            const resText = await api.generateAI(apiKey, text, sys, messages);
            
            // Flow Logic: Smart Suggestions
            let suggestions: string[] = [];
            if (opts.type === 'lesson') {
                suggestions = ["Generate Quiz for this Lesson", "Create Rubric for this Lesson"];
                setLessonCtx(resText); // Store context for next steps
            } else if (opts.type === 'quiz') {
                suggestions = ["Generate Answer Key Explanation", "Create Make-up Quiz"];
            }

            const aiMsg: Message = { id: crypto.randomUUID(), role: 'model', text: resText, timestamp: Date.now(), suggestions };
            const finalMsgs = [...updatedMsgs, aiMsg];
            setMessages(finalMsgs);
            api.saveChat(user.id, finalMsgs);
        } catch {
            setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: "Error connecting to AI.", timestamp: Date.now(), isError: true }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleSuggestion = (s: string) => {
        if (s.includes("Quiz")) toggleModal('assessment', true);
        else if (s.includes("Rubric")) toggleModal('rubric', true);
        else handleSendMessage(s);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0] || !user) return;
        const file = e.target.files[0];
        try {
            let content = file.type === 'application/pdf' ? await extractTextFromPDF(file) : 
                          file.name.endsWith('.docx') ? await extractTextFromDOCX(file) : await file.text();
            
            const doc: DocumentFile = {
                id: crypto.randomUUID(), userId: user.id, name: file.name, type: file.type.includes('pdf') ? 'pdf' : 'docx',
                content, size: file.size, uploadDate: Date.now()
            };
            const newDocs = [...docs, doc];
            setDocs(newDocs);
            api.saveDoc(doc);
            setActiveDocId(doc.id);
            setView('chat');
        } catch { alert("File parse error"); }
    };

    if (!user) return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
             <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md">
                 <h1 className="text-2xl font-bold mb-4 dark:text-white">Welcome to Edtech AI</h1>
                 <p className="mb-6 text-gray-600 dark:text-gray-400">Sign in to start creating lesson plans, quizzes, and more.</p>
                 <form onSubmit={(e) => {
                     e.preventDefault();
                     const u: User = { id: crypto.randomUUID(), email: 'demo@user.com', password: '123', name: 'Demo Teacher', role: 'user', plan: 'free', joinedDate: Date.now() };
                     api.saveUser(u);
                     localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(u));
                     setUser(u);
                 }}>
                     <button className="w-full py-3 bg-primary-600 text-white rounded-lg font-bold">Quick Demo Login</button>
                 </form>
             </div>
        </div>
    );

    const activeDoc = docs.find(d => d.id === activeDocId);

    return (
        <div className="flex h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans overflow-hidden">
            
            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 w-full h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 z-40 flex items-center justify-between px-4">
                 <div className="flex items-center gap-2 font-bold text-primary-600">Edtech AI</div>
                 <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2"><IconMenu /></button>
            </div>

            {/* Sidebar (Collapsible) */}
            <div className={`fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 transition-transform duration-200 z-50 shadow-2xl md:shadow-none flex flex-col pt-14 md:pt-0`}>
                <div className="p-5 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
                        <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white">E</div>
                        <span className="hidden md:inline">Edtech AI</span>
                    </div>
                    <button onClick={() => setSidebarOpen(false)} className="md:hidden"><IconClose /></button>
                </div>

                <div className="px-3 py-2 space-y-1">
                    {[
                        { id: 'dashboard', icon: <IconMenu />, label: 'Dashboard' },
                        { id: 'chat', icon: <IconChat />, label: 'Assistant' },
                        { id: 'calendar', icon: <IconCalendar />, label: 'Calendar' }
                    ].map(item => (
                        <button key={item.id} onClick={() => { setView(item.id as any); setSidebarOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === item.id ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                            {item.icon} {item.label}
                        </button>
                    ))}
                </div>

                <div className="px-4 py-4 mt-2">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Documents</h3>
                    <div className="space-y-1 mb-3 max-h-40 overflow-y-auto scrollbar-hide">
                        {docs.map(doc => (
                            <button key={doc.id} onClick={() => { setActiveDocId(doc.id); setView('chat'); setSidebarOpen(false); }} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm truncate ${activeDocId === doc.id ? 'bg-gray-100 dark:bg-gray-800 font-medium' : 'text-gray-500'}`}>
                                <IconFile type={doc.type} /> <span className="truncate">{doc.name}</span>
                            </button>
                        ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 cursor-pointer px-2">
                        <IconUpload /> Upload New <input type="file" className="hidden" accept=".pdf,.docx,.txt" onChange={handleFileUpload} />
                    </label>
                </div>

                <div className="mt-auto p-4 border-t border-gray-200 dark:border-gray-800">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">{user.name[0]}</div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate dark:text-white">{user.name}</div>
                            <button onClick={() => toggleModal('terms', true)} className="text-xs text-gray-400 hover:underline flex items-center gap-1"><IconInfo /> Terms</button>
                        </div>
                    </div>
                    <button onClick={() => { localStorage.clear(); location.reload(); }} className="w-full py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">Sign Out</button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 md:pl-64 pt-14 md:pt-0 bg-gray-50 dark:bg-gray-900">
                 {view === 'dashboard' && (
                     <div className="p-4 md:p-8 overflow-y-auto h-full">
                         <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-6">Hello, {user.name}</h1>
                         
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mb-8">
                             {[
                                 { title: "Lesson Planner", icon: <IconClipboard />, color: "blue", action: () => toggleModal('lesson', true), desc: "Create 5E or UbD plans." },
                                 { title: "Quiz Maker", icon: <IconClipboardCheck />, color: "green", action: () => toggleModal('assessment', true), desc: "Generate tests with keys." },
                                 { title: "Rubric Builder", icon: <IconTable />, color: "purple", action: () => toggleModal('rubric', true), desc: "Design grading criteria." }
                             ].map((tool, i) => (
                                 <button key={i} onClick={tool.action} className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all text-left">
                                     <div className={`w-10 h-10 bg-${tool.color}-100 dark:bg-${tool.color}-900/30 rounded-lg flex items-center justify-center text-${tool.color}-600 mb-4`}>{tool.icon}</div>
                                     <h3 className="font-bold text-lg mb-1 dark:text-white">{tool.title}</h3>
                                     <p className="text-sm text-gray-500 dark:text-gray-400">{tool.desc}</p>
                                 </button>
                             ))}
                         </div>
                         
                         <div className="bg-gradient-to-r from-primary-800 to-indigo-900 rounded-2xl p-6 md:p-8 text-white relative overflow-hidden shadow-xl">
                             <div className="relative z-10">
                                 <h2 className="text-2xl font-bold mb-2">Upload your curriculum</h2>
                                 <p className="text-indigo-200 mb-4 max-w-lg">Get context-aware lesson plans, quizzes, and worksheets instantly.</p>
                                 <button onClick={() => setView('chat')} className="px-6 py-2 bg-white text-primary-900 font-bold rounded-lg hover:bg-gray-100">Open Assistant</button>
                             </div>
                         </div>
                     </div>
                 )}

                 {view === 'chat' && (
                     <ChatInterface 
                         activeDoc={activeDoc} 
                         messages={messages} 
                         isThinking={isThinking} 
                         onSendMessage={handleSendMessage}
                         onClearChat={() => { setMessages([]); if(user) api.saveChat(user.id, []); }}
                         onClearContext={() => setActiveDocId(null)}
                         onSuggestionClick={handleSuggestion}
                     />
                 )}
            </div>

            {/* Modals */}
            <GeneratorModal title="Lesson Planner" icon={<IconClipboard />} isOpen={modalState.lesson} onClose={() => toggleModal('lesson', false)} onGenerate={() => { 
                // Simplified Generation Logic for brevity
                const topic = (document.getElementById('lesson-topic') as HTMLInputElement).value;
                handleSendMessage(`Create a lesson plan on ${topic}.`, 'report', { type: 'lesson' });
                toggleModal('lesson', false);
            }}>
                <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Topic</label>
                    <input id="lesson-topic" className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 outline-none dark:text-white" placeholder="e.g. Photosynthesis" />
                </div>
            </GeneratorModal>

            <GeneratorModal title="Quiz Maker" icon={<IconClipboardCheck />} isOpen={modalState.assessment} onClose={() => toggleModal('assessment', false)} onGenerate={() => {
                const topic = (document.getElementById('quiz-topic') as HTMLInputElement).value;
                // Use lessonCtx if available to ground the quiz
                const prompt = lessonCtx ? `Based on this lesson plan: ${lessonCtx.substring(0,500)}..., create a quiz on ${topic}` : `Create a quiz on ${topic}`;
                handleSendMessage(prompt, 'auto', { type: 'quiz' });
                toggleModal('assessment', false);
            }}>
                <div>
                    <label className="block text-sm font-medium mb-1 dark:text-gray-300">Topic</label>
                    <input id="quiz-topic" className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border dark:border-gray-600 outline-none dark:text-white" defaultValue={lessonCtx ? "the lesson plan above" : ""} />
                </div>
            </GeneratorModal>
            
            <GeneratorModal title="Rubric Builder" icon={<IconTable />} isOpen={modalState.rubric} onClose={() => toggleModal('rubric', false)} onGenerate={() => {
                 handleSendMessage(`Create a rubric.`, 'table'); toggleModal('rubric', false);
            }}>
                 <p className="text-gray-500">Quick Rubric Generator</p>
            </GeneratorModal>

            <TermsModal isOpen={modalState.terms} onClose={() => toggleModal('terms', false)} />
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
