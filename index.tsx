import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Content } from "@google/genai";
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// --- CONFIGURATION & HYBRID FALLBACK ---
const getEnv = (key: string) => {
    try {
        // @ts-ignore
        if (typeof import.meta !== 'undefined' && import.meta.env) return import.meta.env[key];
    } catch(e) {}
    try {
        if (typeof process !== 'undefined' && process.env) return process.env[key];
    } catch(e) {}
    return undefined;
}

const ENV_URL = getEnv('VITE_SUPABASE_URL');
const ENV_KEY = getEnv('VITE_SUPABASE_ANON_KEY');

const isSupabaseConfigured = !!(ENV_URL && ENV_URL !== "https://your-project.supabase.co" && ENV_KEY && ENV_KEY !== "your-anon-key");

// Prevent initializing client with bad data to avoid network timeouts/errors
const supabase: SupabaseClient | null = isSupabaseConfigured 
    ? createClient(ENV_URL!, ENV_KEY!) 
    : null;

// --- Constants & Storage Keys ---
const STORAGE_KEYS = {
  USERS: 'edtech_users_v5', 
  SESSION: 'edtech_session_v5',
  DOCS_PREFIX: 'edtech_docs_v5_', 
  CHAT_PREFIX: 'edtech_chat_v5_',
  EVENTS_PREFIX: 'edtech_events_v5_',
  SETTINGS: 'edtech_settings_v5',
  API_KEY: 'edtech_temp_key'
};

const DEFAULT_SYSTEM_INSTRUCTION = `
ROLE: You are "Edtech AI", an elite pedagogical consultant.
CORE DIRECTIVES: Apply Bloom's Taxonomy, 5E Model, and UbD.
`.trim();

const PLAN_LIMITS = {
  free: { maxDocs: 1, maxSizeMB: 5, label: 'Free Tier' },
  pro: { maxDocs: 10, maxSizeMB: 20, label: 'Educator Pro' },
  campus: { maxDocs: 999, maxSizeMB: 50, label: 'Campus Plan' }
};

const FORMAT_OPTIONS: { id: OutputFormat; label: string; instruction: string }[] = [
  { id: 'auto', label: 'Auto', instruction: "Answer naturally." },
  { id: 'report', label: 'Report', instruction: "Professional report format with H1/H2." },
  { id: 'table', label: 'Table', instruction: "Markdown table format." },
  { id: 'concise', label: 'Concise', instruction: "Brief summary (BLUF)." },
  { id: 'step', label: 'Steps', instruction: "Numbered step-by-step guide." }
];

// --- Types ---
type PlanType = 'free' | 'pro' | 'campus';

interface DocumentFile {
  id: string;
  user_id: string;
  name: string;
  type: 'pdf' | 'docx' | 'txt';
  content: string;
  size: number;
  created_at?: number;
}

interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isError?: boolean;
  suggestions?: Suggestion[]; 
  isThinking?: boolean; 
}

interface Suggestion {
  label: string;
  action: 'quiz' | 'rubric' | 'chat';
  prompt?: string;
}

interface CalendarEvent {
    id: string;
    title: string;
    date: string; // ISO date string YYYY-MM-DD
    type: 'class' | 'deadline' | 'meeting';
}

type OutputFormat = 'auto' | 'report' | 'table' | 'concise' | 'step';

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: 'user' | 'admin';
  plan: PlanType;
}

declare global {
  interface Window {
    pdfjsLib: any;
    mammoth: any;
    marked: any;
    jspdf: any;
  }
}

// --- Icons ---
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
const IconSend = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>;
const IconBot = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
const IconDownload = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
const IconTable = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7-4h14M4 6h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" /></svg>;
const IconClipboard = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
const IconClipboardCheck = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>;
const IconCalendar = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
const IconChat = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>;
const IconInfo = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
const IconKey = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>;
const IconSettings = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>;
const IconCloud = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>;
const IconOffline = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" /></svg>;
const IconBrain = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;

// --- API LAYER (HYBRID) ---
const api = {
    getProfile: async (): Promise<UserProfile | null> => {
        if (!supabase) {
             const sessionStr = localStorage.getItem(STORAGE_KEYS.SESSION);
             return sessionStr ? JSON.parse(sessionStr) : null;
        }
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
            if (error) {
                 return { id: user.id, email: user.email!, full_name: user.user_metadata.full_name || 'User', role: 'user', plan: 'free' };
            }
            return data;
        } catch { return null; }
    },

    saveUserLocal: (user: UserProfile) => {
        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(user));
    },

    saveDoc: async (doc: DocumentFile) => {
        if (!supabase) {
             const key = `${STORAGE_KEYS.DOCS_PREFIX}${doc.user_id}`;
             const docsStr = localStorage.getItem(key);
             const docs: DocumentFile[] = docsStr ? JSON.parse(docsStr) : [];
             docs.push(doc);
             localStorage.setItem(key, JSON.stringify(docs));
             return;
        }
        try {
            const { error } = await supabase.from('documents').insert(doc);
            if (error) console.error("Doc Save Error:", error);
        } catch(e) { console.error("Doc Save Exception:", e); }
    },

    getDocs: async (userId: string): Promise<DocumentFile[]> => {
        if (!supabase) {
            const key = `${STORAGE_KEYS.DOCS_PREFIX}${userId}`;
            const docsStr = localStorage.getItem(key);
            return docsStr ? JSON.parse(docsStr) : [];
        }
        const { data } = await supabase.from('documents').select('*').eq('user_id', userId);
        return data || [];
    },

    saveChat: async (userId: string, messages: Message[]) => {
        if (!supabase) {
             localStorage.setItem(`${STORAGE_KEYS.CHAT_PREFIX}${userId}`, JSON.stringify(messages));
             return;
        }
        try {
            const { data } = await supabase.from('chats').select('id').eq('user_id', userId).maybeSingle();
            if (data) {
                await supabase.from('chats').update({ messages }).eq('id', data.id);
            } else {
                await supabase.from('chats').insert({ user_id: userId, messages });
            }
        } catch (err) {
            console.error("Chat sync failed (Tables might be missing):", err);
        }
    },

    getChat: async (userId: string): Promise<Message[]> => {
        if (!supabase) {
            const str = localStorage.getItem(`${STORAGE_KEYS.CHAT_PREFIX}${userId}`);
            return str ? JSON.parse(str) : [];
        }
        const { data } = await supabase.from('chats').select('messages').eq('user_id', userId).single();
        return data?.messages || [];
    },

    // --- ASYNC CALENDAR EVENTS (DB + Fallback) ---
    getEvents: async (userId: string): Promise<CalendarEvent[]> => {
        if (!supabase) {
            const str = localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`);
            return str ? JSON.parse(str) : [];
        }
        try {
            const { data, error } = await supabase.from('events').select('*').eq('user_id', userId);
            // If table doesn't exist (error 404/42P01), fall back to local
            if (error) throw error; 
            return data || [];
        } catch (e) {
            // Quiet fail to local storage to prevent app crash if SQL wasn't run
            const str = localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`);
            return str ? JSON.parse(str) : [];
        }
    },

    saveEvent: async (userId: string, event: CalendarEvent) => {
        if (!supabase) {
            const current = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`) || "[]");
            current.push(event);
            localStorage.setItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`, JSON.stringify(current));
            return;
        }
        try {
            const { error } = await supabase.from('events').insert({
                id: event.id,
                user_id: userId,
                title: event.title,
                date: event.date,
                type: event.type
            });
            if (error) throw error;
        } catch (e) {
            // Fallback
            const current = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`) || "[]");
            current.push(event);
            localStorage.setItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`, JSON.stringify(current));
        }
    },
    
    deleteEvent: async (userId: string, eventId: string) => {
        if(!supabase) {
             const current = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`) || "[]");
             const next = current.filter((e: CalendarEvent) => e.id !== eventId);
             localStorage.setItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`, JSON.stringify(next));
             return;
        }
        try {
            const { error } = await supabase.from('events').delete().eq('id', eventId);
            if(error) throw error;
        } catch(e) {
             const current = JSON.parse(localStorage.getItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`) || "[]");
             const next = current.filter((e: CalendarEvent) => e.id !== eventId);
             localStorage.setItem(`${STORAGE_KEYS.EVENTS_PREFIX}${userId}`, JSON.stringify(next));
        }
    },

    // App Brain
    getMasterPrompt: async (): Promise<string> => {
        if (!supabase) {
            return localStorage.getItem('edtech_master_prompt') || DEFAULT_SYSTEM_INSTRUCTION;
        }
        const { data } = await supabase.from('system_settings').select('value').eq('key', 'master_prompt').maybeSingle();
        return data?.value || DEFAULT_SYSTEM_INSTRUCTION;
    },

    setMasterPrompt: async (prompt: string) => {
        if (!supabase) {
            localStorage.setItem('edtech_master_prompt', prompt);
            return;
        }
        try {
            const { data } = await supabase.from('system_settings').select('key').eq('key', 'master_prompt').maybeSingle();
            if(data) {
                await supabase.from('system_settings').update({ value: prompt }).eq('key', 'master_prompt');
            } else {
                await supabase.from('system_settings').insert({ key: 'master_prompt', value: prompt });
            }
        } catch(e) { console.error("Settings Save Error:", e); alert("Failed to save settings to DB."); }
    },

    getAllUsers: async (): Promise<UserProfile[]> => {
        if (!supabase) return [];
        try {
            const { data } = await supabase.from('profiles').select('*').order('joined_date', { ascending: false });
            return data || [];
        } catch { return []; }
    },

    // AI Generation (Streaming + Deep Think)
    generateAIStream: async function* (apiKey: string, prompt: string, sys: string, hist: any[], useThinking: boolean) {
        const ai = new GoogleGenAI({ apiKey });
        const contents: Content[] = hist.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));
        contents.push({ role: 'user', parts: [{ text: prompt }] });
        
        const config: any = { systemInstruction: sys };
        
        // Deep Thinking Config (Gemini 2.5 Flash only)
        if (useThinking) {
            // Budget is token count for internal reasoning
            config.thinkingConfig = { thinkingBudget: 4096 }; 
        }

        const result = await ai.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: contents,
            config: config
        });

        for await (const chunk of result) {
            yield chunk.text; 
        }
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

const getApiKey = (): string | null => {
    const key = getEnv('API_KEY') || getEnv('VITE_API_KEY');
    if (key) return key;
    return sessionStorage.getItem(STORAGE_KEYS.API_KEY);
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

const TermsModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700 max-h-[80vh] overflow-y-auto">
                <div className="p-6">
                    <h2 className="text-xl font-bold mb-4 dark:text-white flex items-center gap-2"><IconInfo /> Terms & AI Transparency</h2>
                    <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
                        <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg border border-blue-100 dark:border-blue-800">
                            <strong>AI Disclaimer:</strong> This app uses Google Gemini. Output may be inaccurate. Verify all educational content before use.
                        </div>
                        <p><strong>Data Privacy:</strong> {isSupabaseConfigured ? "Your data is securely stored in Supabase with RLS protection." : "You are in Local/Demo Mode. Data is stored only in your browser."}</p>
                        <p><strong>Freemium Limits:</strong> Free tier is limited. Upgrade to 'Pro' to unlock more.</p>
                    </div>
                    <button onClick={onClose} className="mt-6 w-full py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">I Understand</button>
                </div>
            </div>
        </div>
    );
};

const ApiKeyModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    const [key, setKey] = useState('');
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700">
                <div className="p-6">
                    <h2 className="text-lg font-bold mb-2 dark:text-white flex items-center gap-2"><IconKey /> Setup API Key</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        Please enter your Google Gemini API key. Stored locally in session.
                    </p>
                    <input 
                        type="password" 
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full px-4 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 outline-none mb-4 dark:text-white"
                    />
                    <div className="flex gap-2">
                         <a href="https://aistudio.google.com/app/apikey" target="_blank" className="flex-1 py-2 text-center text-sm text-primary-600 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg border border-transparent">Get Key</a>
                         <button onClick={() => { if(key) { sessionStorage.setItem(STORAGE_KEYS.API_KEY, key); onClose(); } }} className="flex-1 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-bold">Save & Start</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Admin Modal: Now with Brain Editing + User List
const AdminSettingsModal = ({ isOpen, onClose, user }: { isOpen: boolean, onClose: () => void, user: UserProfile }) => {
    const [prompt, setPrompt] = useState('');
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'brain'|'users'>('brain');

    useEffect(() => {
        if (isOpen) {
            api.getMasterPrompt().then(setPrompt);
            api.getAllUsers().then(setUsers);
        }
    }, [isOpen]);

    const handleSave = async () => {
        setLoading(true);
        try {
            await api.setMasterPrompt(prompt);
            alert("System Brain Updated!");
        } catch(e) {
            alert("Failed to update.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
         <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-md p-4 animate-fadeIn">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl border border-gray-700 h-[80vh] flex flex-col">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-white font-bold flex items-center gap-2"><IconSettings /> Admin Console</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><IconClose /></button>
                </div>
                
                {/* Tabs */}
                <div className="flex border-b border-gray-700">
                    <button onClick={() => setActiveTab('brain')} className={`px-6 py-3 text-sm font-medium ${activeTab === 'brain' ? 'text-white border-b-2 border-green-500' : 'text-gray-400 hover:text-white'}`}>App Brain</button>
                    <button onClick={() => setActiveTab('users')} className={`px-6 py-3 text-sm font-medium ${activeTab === 'users' ? 'text-white border-b-2 border-green-500' : 'text-gray-400 hover:text-white'}`}>Users ({users.length})</button>
                </div>

                <div className="flex-1 p-4 overflow-hidden">
                     {activeTab === 'brain' ? (
                         <div className="h-full flex flex-col">
                             <p className="text-gray-400 text-xs mb-2">Configure the master system instruction for all users.</p>
                             <textarea 
                                value={prompt}
                                onChange={e => setPrompt(e.target.value)}
                                className="flex-1 w-full bg-black text-green-400 font-mono text-sm p-4 rounded border border-gray-700 outline-none resize-none mb-4"
                             />
                             <div className="flex justify-end">
                                <button onClick={handleSave} disabled={loading} className="px-6 py-2 bg-green-600 text-white font-bold rounded hover:bg-green-700">
                                    {loading ? 'Saving...' : 'Update Brain'}
                                </button>
                             </div>
                         </div>
                     ) : (
                         <div className="h-full overflow-y-auto">
                            {!users.length ? (
                                <p className="text-gray-500 p-4">No users found or RLS restricted.</p>
                            ) : (
                                 <table className="w-full text-sm text-left text-gray-400">
                                     <thead className="text-xs text-gray-200 uppercase bg-gray-800">
                                         <tr>
                                             <th className="px-4 py-3">Name</th>
                                             <th className="px-4 py-3">Email</th>
                                             <th className="px-4 py-3">Plan</th>
                                             <th className="px-4 py-3">Role</th>
                                         </tr>
                                     </thead>
                                     <tbody>
                                         {users.map(u => (
                                             <tr key={u.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                                                 <td className="px-4 py-3 font-medium text-white">{u.full_name}</td>
                                                 <td className="px-4 py-3">{u.email}</td>
                                                 <td className="px-4 py-3"><span className={`px-2 py-1 rounded text-xs ${u.plan === 'free' ? 'bg-gray-700' : 'bg-purple-900 text-purple-200'}`}>{u.plan}</span></td>
                                                 <td className="px-4 py-3">{u.role}</td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                            )}
                         </div>
                     )}
                </div>
            </div>
         </div>
    );
}

const PricingModal = ({ isOpen, onClose, user }: { isOpen: boolean, onClose: () => void, user: UserProfile }) => {
    if (!isOpen) return null;
    const handleUpgrade = async (plan: PlanType) => {
        if (!isSupabaseConfigured) {
             const updated = { ...user, plan };
             api.saveUserLocal(updated);
             alert(`Upgraded to ${plan} (Demo Mode).`);
             window.location.reload();
             return;
        }
        const { error } = await supabase!.from('profiles').update({ plan }).eq('id', user.id);
        if(!error) {
            alert(`Upgraded to ${plan}! Refreshing...`);
            window.location.reload();
        }
    };

    return (
         <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 max-w-3xl w-full shadow-2xl">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold dark:text-white">Upgrade Plan</h2>
                    <button onClick={onClose}><IconClose /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Object.entries(PLAN_LIMITS).map(([key, val]) => (
                        <div key={key} className={`border ${user.plan === key ? 'border-primary-500 ring-2 ring-primary-500' : 'border-gray-200 dark:border-gray-700'} rounded-xl p-6 relative`}>
                            {user.plan === key && <div className="absolute top-2 right-2 text-xs font-bold text-primary-600 bg-primary-50 px-2 py-1 rounded">CURRENT</div>}
                            <h3 className="font-bold text-lg capitalize dark:text-white">{key}</h3>
                            <ul className="mt-4 text-sm space-y-2 text-gray-600 dark:text-gray-400">
                                <li>{val.maxDocs} Documents</li>
                                <li>{val.maxSizeMB}MB Max Size</li>
                            </ul>
                            <button 
                                onClick={() => handleUpgrade(key as PlanType)}
                                disabled={user.plan === key}
                                className={`mt-6 w-full py-2 rounded-lg text-sm font-bold ${user.plan === key ? 'bg-gray-100 text-gray-400' : 'bg-primary-600 text-white hover:bg-primary-700'}`}
                            >
                                {user.plan === key ? 'Active' : 'Select'}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
         </div>
    );
};

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

// --- Calendar View Component ---
const CalendarView = ({ user }: { user: UserProfile }) => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const [currentDate, setCurrentDate] = useState(new Date());
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [newEventTitle, setNewEventTitle] = useState('');
    const [selectedDate, setSelectedDate] = useState<number | null>(null);

    // Fetch events on mount and when date changes (mock efficiency, just refetching all for now)
    useEffect(() => {
        const fetchEvents = async () => {
            const data = await api.getEvents(user.id);
            setEvents(data);
        };
        fetchEvents();
    }, [user.id]);

    const handleAddEvent = async () => {
        if(!newEventTitle || !selectedDate) return;
        const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDate);
        // Correct date offset issue by using UTC string components or simple string concat
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2, '0')}-${String(selectedDate).padStart(2, '0')}`;
        
        const event: CalendarEvent = {
            id: crypto.randomUUID(),
            title: newEventTitle,
            date: dateStr,
            type: 'class'
        };
        
        // Optimistic UI
        setEvents([...events, event]);
        await api.saveEvent(user.id, event);
        
        setNewEventTitle('');
        setSelectedDate(null);
    };

    const handleDeleteEvent = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if(confirm("Delete this event?")) {
            setEvents(events.filter(ev => ev.id !== id));
            await api.deleteEvent(user.id, id);
        }
    }

    const getEventsForDay = (day: number) => {
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return events.filter(e => e.date === dateStr);
    };
    
    return (
        <div className="p-4 md:p-8 h-full overflow-y-auto">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Class Calendar</h1>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex gap-4 items-center">
                        <h2 className="text-lg font-bold dark:text-white">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
                         <div className="flex gap-1">
                            <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()-1))} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">←</button>
                            <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth()+1))} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">→</button>
                         </div>
                    </div>
                    <button onClick={() => setCurrentDate(new Date())} className="text-sm text-primary-600">Today</button>
                </div>
                
                {selectedDate && (
                    <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg flex gap-2 animate-fadeIn">
                        <input 
                            value={newEventTitle} 
                            onChange={e => setNewEventTitle(e.target.value)} 
                            placeholder={`Event for ${currentDate.toLocaleString('default', {month:'short'})} ${selectedDate}...`}
                            className="flex-1 bg-transparent border-b border-gray-300 dark:border-gray-700 outline-none text-sm dark:text-white"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleAddEvent()}
                        />
                        <button onClick={handleAddEvent} className="text-xs bg-primary-600 text-white px-3 py-1 rounded">Add</button>
                        <button onClick={() => setSelectedDate(null)} className="text-xs text-gray-500">Cancel</button>
                    </div>
                )}

                <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                    {days.map(d => (
                        <div key={d} className="bg-gray-50 dark:bg-gray-800 p-2 text-center text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{d}</div>
                    ))}
                    {Array.from({length: new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()}).map((_, i) => {
                        const day = i + 1;
                        const dayEvents = getEventsForDay(day);
                        return (
                            <div key={i} onClick={() => setSelectedDate(day)} className={`bg-white dark:bg-gray-800 p-2 min-h-[100px] hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer relative ${selectedDate === day ? 'ring-2 ring-inset ring-primary-500' : ''}`}>
                                <span className="text-xs font-medium text-gray-400">{day}</span>
                                <div className="mt-1 space-y-1">
                                    {dayEvents.map(ev => (
                                        <div key={ev.id} className="group relative text-[10px] bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded truncate pr-4">
                                            {ev.title}
                                            <button onClick={(e) => handleDeleteEvent(e, ev.id)} className="hidden group-hover:block absolute right-0 top-0 bottom-0 px-1 text-red-500 hover:bg-red-100">×</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const ChatInterface = ({ 
    activeDoc, messages, isThinking, onSendMessage, onClearChat, onClearContext, onSuggestionClick 
}: any) => {
    const [input, setInput] = useState('');
    const [useDeepThink, setUseDeepThink] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, isThinking]);

    const handleSend = () => { if(input.trim()) { onSendMessage(input, 'auto', { useDeepThink }); setInput(''); } };
    
    return (
        <div className="flex flex-col h-full bg-white dark:bg-gray-900 relative">
            <div className="h-14 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 bg-white dark:bg-gray-900 z-10 sticky top-0">
                 <div className="flex items-center gap-2 overflow-hidden">
                     <div className={`w-2 h-2 rounded-full flex-shrink-0 ${activeDoc ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                     <span className="text-sm font-medium text-gray-600 dark:text-gray-300 truncate max-w-[150px] xs:max-w-none">
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
                            <div className="flex gap-2 mt-2 flex-wrap justify-end md:justify-start animate-fadeIn">
                                {msg.suggestions.map((s: Suggestion, i: number) => (
                                    <button key={i} onClick={() => onSuggestionClick(s)} className="text-xs flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-3 py-1.5 rounded-full border border-indigo-100 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors shadow-sm">
                                        ✨ {s.label}
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
                        className="w-full pl-10 pr-12 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-primary-500 outline-none resize-none shadow-sm dark:text-white"
                        rows={1}
                    />
                    <button 
                        onClick={() => setUseDeepThink(!useDeepThink)}
                        className={`absolute left-3 bottom-3 transition-colors ${useDeepThink ? 'text-purple-500 animate-pulse' : 'text-gray-400 hover:text-purple-500'}`}
                        title={useDeepThink ? "Deep Think Active (Slower, reasoned)" : "Enable Deep Think"}
                    >
                        <IconBrain />
                    </button>
                    {useDeepThink && <span className="absolute left-10 bottom-3.5 text-xs text-purple-500 font-bold pointer-events-none animate-fadeIn">Thinking Mode</span>}
                    <button onClick={handleSend} disabled={!input.trim() || isThinking} className="absolute right-2 bottom-2 p-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"><IconSend /></button>
                </div>
                <div className="flex gap-2 mt-2 overflow-x-auto scrollbar-hide">
                    {FORMAT_OPTIONS.map(fmt => (
                        <button key={fmt.id} onClick={() => onSendMessage(input || "Generate.", fmt.id, { useDeepThink })} className="text-xs px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap">{fmt.label}</button>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- App Component ---

const App = () => {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [view, setView] = useState<'chat' | 'calendar' | 'dashboard'>('dashboard');
    const [docs, setDocs] = useState<DocumentFile[]>([]);
    const [activeDocId, setActiveDocId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
    const [authLoading, setAuthLoading] = useState(false);

    const [modalState, setModalState] = useState({
        pricing: false, rubric: false, lesson: false, assessment: false, event: false, settings: false, terms: false, apiKey: false
    });

    const [lessonCtx, setLessonCtx] = useState<string>(""); 

    useEffect(() => {
        // Safe logging for debug
        console.log("App Mounted");
        
        if (supabase) {
            const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
                if (session) {
                    const profile = await api.getProfile();
                    setUser(profile);
                    if(profile) {
                        setDocs(await api.getDocs(profile.id));
                        setMessages(await api.getChat(profile.id));
                    }
                } else {
                    setUser(null);
                }
            });
            return () => authListener.subscription.unsubscribe();
        } else {
            const init = async () => {
                const profile = await api.getProfile();
                setUser(profile);
                if(profile) {
                    setDocs(await api.getDocs(profile.id));
                    setMessages(await api.getChat(profile.id));
                }
            };
            init();
        }
    }, []);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setAuthLoading(true);
        try {
            if (!supabase) {
                const u: UserProfile = { 
                    id: 'local-user', 
                    email: email, 
                    full_name: 'Demo Teacher', 
                    role: 'user', 
                    plan: 'free' 
                };
                api.saveUserLocal(u);
                setUser(u);
                alert("Logged in (Demo Mode)");
                return;
            }

            if (authMode === 'signin') {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signUp({ 
                    email, 
                    password, 
                    options: { data: { full_name: 'New Educator' } } 
                });
                if (error) throw error;
                alert("Account created! You are logged in.");
            }
        } catch (error: any) {
            alert(error.message);
        } finally {
            setAuthLoading(false);
        }
    };

    const toggleModal = (key: keyof typeof modalState, val: boolean) => setModalState(prev => ({ ...prev, [key]: val }));

    // UPDATED: Handle Streaming
    const handleSendMessage = async (text: string, formatId: OutputFormat = 'auto', opts: { useActiveDoc?: boolean, type?: string, useDeepThink?: boolean } = {}) => {
        if (!user) return;
        
        const apiKey = getApiKey();
        if (!apiKey) { toggleModal('apiKey', true); return; }

        const newUserMsg: Message = { id: crypto.randomUUID(), role: 'user', text, timestamp: Date.now() };
        // Optimistically add user message
        const intermediateMsgs = [...messages, newUserMsg];
        setMessages(intermediateMsgs);
        api.saveChat(user.id, intermediateMsgs);
        
        setView('chat');
        setIsThinking(true);

        const activeDoc = docs.find(d => d.id === activeDocId);
        const includeDoc = opts.useActiveDoc !== undefined ? opts.useActiveDoc : !!activeDocId;
        
        let sys = await api.getMasterPrompt(); 
        if (includeDoc && activeDoc) sys += `\n\n=== CONTEXT: ${activeDoc.name} ===\n${activeDoc.content.substring(0, 30000)}`;
        const fmt = FORMAT_OPTIONS.find(f => f.id === formatId);
        if (fmt) sys += `\n\nFORMAT: ${fmt.instruction}`;

        try {
            // Create a placeholder message for the AI
            const aiMsgId = crypto.randomUUID();
            let aiText = "";
            // Initial AI message state (empty)
            setMessages(prev => [...prev, { id: aiMsgId, role: 'model', text: "", timestamp: Date.now(), isThinking: true }]);

            // Stream Loop
            const stream = api.generateAIStream(apiKey, text, sys, intermediateMsgs, opts.useDeepThink || false);
            
            for await (const chunkText of stream) {
                if(chunkText) {
                    aiText += chunkText;
                    setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: aiText, isThinking: false } : m));
                    setIsThinking(false); // First chunk received, stop main thinking loader
                }
            }

            // Post-generation logic (Suggestions)
            let suggestions: Suggestion[] = [];
            if (opts.type === 'lesson' || text.toLowerCase().includes('lesson plan')) {
                suggestions = [
                    { label: "Create Quiz for this", action: 'quiz', prompt: `Create a quiz based on this lesson plan.` },
                    { label: "Generate Rubric", action: 'rubric' }
                ];
                setLessonCtx(aiText);
            } else if (opts.type === 'quiz' || text.toLowerCase().includes('quiz')) {
                suggestions = [{ label: "Explain Answer Key", action: 'chat', prompt: "Explain the answer key in detail." }];
            }

            // Update final message with suggestions
            const finalMsgs: Message[] = [...intermediateMsgs, { id: aiMsgId, role: 'model', text: aiText, timestamp: Date.now(), suggestions }];
            setMessages(finalMsgs);
            api.saveChat(user.id, finalMsgs);

        } catch (e) {
            console.error(e);
            setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'model', text: "Error connecting to AI. Please check your API key.", timestamp: Date.now(), isError: true }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleSuggestion = (s: Suggestion) => {
        if (s.action === 'quiz') toggleModal('assessment', true);
        else if (s.action === 'rubric') toggleModal('rubric', true);
        else if (s.prompt) handleSendMessage(s.prompt);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0] || !user) return;
        
        // FREEMIUM CHECK
        const limit = PLAN_LIMITS[user.plan].maxDocs;
        if (docs.length >= limit) {
             alert(`Plan limit reached (${limit}). Upgrade to add more.`);
             toggleModal('pricing', true);
             return;
        }

        const file = e.target.files[0];
        try {
            let content = file.type === 'application/pdf' ? await extractTextFromPDF(file) : 
                          file.name.endsWith('.docx') ? await extractTextFromDOCX(file) : await file.text();
            
            const doc: DocumentFile = {
                id: crypto.randomUUID(), user_id: user.id, name: file.name, type: file.type.includes('pdf') ? 'pdf' : 'docx',
                content, size: file.size, created_at: Date.now()
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
             <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
                 <div className="text-center mb-8">
                     <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">E</div>
                     <h1 className="text-2xl font-bold dark:text-white">Welcome to Edtech AI</h1>
                     <p className="mt-2 text-gray-600 dark:text-gray-400">Sign in to start planning.</p>
                     {!supabase && (
                         <div className="mt-4 p-2 bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 text-xs rounded border border-yellow-200 dark:border-yellow-800 flex items-center justify-center gap-2">
                             <IconOffline /> 
                             <span>Demo Mode (Local Storage Only)</span>
                         </div>
                     )}
                 </div>
                 <form onSubmit={handleAuth} className="space-y-4">
                     <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700 border outline-none dark:text-white" required />
                     <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-700 border outline-none dark:text-white" required />
                     <button disabled={authLoading} className="w-full py-3 bg-primary-600 text-white rounded-lg font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-500/30">
                         {authLoading ? 'Processing...' : (authMode === 'signin' ? 'Sign In' : 'Create Account')}
                     </button>
                 </form>
                 <button onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')} className="mt-4 text-sm text-primary-500 hover:underline w-full text-center">
                     {authMode === 'signin' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                 </button>
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
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">{user.email[0].toUpperCase()}</div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate dark:text-white">{user.full_name}</div>
                            <button onClick={() => toggleModal('pricing', true)} className="text-xs text-primary-500 hover:underline uppercase font-bold">{user.plan}</button>
                        </div>
                         {user.role === 'admin' && (
                            <button onClick={() => toggleModal('settings', true)} className="text-gray-400 hover:text-white" title="Admin Settings">
                                <IconSettings />
                            </button>
                        )}
                    </div>
                    <button onClick={() => { supabase ? supabase.auth.signOut() : (localStorage.removeItem(STORAGE_KEYS.SESSION), window.location.reload()) }} className="w-full py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800">Sign Out</button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 md:pl-64 pt-14 md:pt-0 bg-gray-50 dark:bg-gray-900">
                 {view === 'dashboard' && (
                     <div className="p-4 md:p-8 overflow-y-auto h-full">
                         <div className="flex justify-between items-center mb-6">
                            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Hello, {user.full_name}</h1>
                            {supabase ? (
                                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full flex items-center gap-1"><IconCloud /> Online</span>
                            ) : (
                                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full flex items-center gap-1"><IconOffline /> Offline</span>
                            )}
                         </div>
                         
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
                                 <button onClick={() => setView('chat')} className="px-6 py-2 bg-white text-primary-900 font-bold rounded-lg hover:bg-gray-100 text-sm md:text-base">Open Assistant</button>
                             </div>
                         </div>
                     </div>
                 )}
                 
                 {view === 'calendar' && <CalendarView user={user} />}

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
            <ApiKeyModal isOpen={modalState.apiKey} onClose={() => toggleModal('apiKey', false)} />
            {user && <AdminSettingsModal isOpen={modalState.settings} onClose={() => toggleModal('settings', false)} user={user} />}
            {user && <PricingModal isOpen={modalState.pricing} onClose={() => toggleModal('pricing', false)} user={user} />}
        </div>
    );
};

const root = createRoot(document.getElementById('root')!);
try {
  root.render(<App />);
} catch(e) {
  console.error("Mounting Error:", e);
  document.getElementById('root')!.innerHTML = `<div style="color:red; padding:20px;">App Crashed: ${e}</div>`;
}