"""
Модуль для хранения и анализа связей кошельков в БД
"""
import sqlite3
from typing import List, Dict, Tuple
from datetime import datetime

def init_wallet_links_db(db_name: str = "tasks_bot.db"):
    """Инициализация таблиц для хранения связей кошельков"""
    conn = sqlite3.connect(db_name)
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS wallet_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wallet_from TEXT NOT NULL,
        wallet_to TEXT NOT NULL,
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(wallet_from, wallet_to)
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS suspicious_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        linked_user_id INTEGER NOT NULL,
        confidence_score REAL DEFAULT 0.0,
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'pending',
        UNIQUE(user_id, linked_user_id)
    )''')
    
    conn.commit()
    conn.close()

def save_wallet_link(wallet_from: str, wallet_to: str, db_name: str = "tasks_bot.db"):
    """Сохранить связь между кошельками"""
    conn = sqlite3.connect(db_name)
    c = conn.cursor()
    try:
        c.execute("INSERT OR IGNORE INTO wallet_links (wallet_from, wallet_to) VALUES (?, ?)",
                  (wallet_from, wallet_to))
        conn.commit()
    finally:
        conn.close()

def save_suspicious_link(user_id: int, linked_user_id: int, confidence: float, 
                         db_name: str = "tasks_bot.db"):
    """Сохранить подозрительную связь между пользователями"""
    conn = sqlite3.connect(db_name)
    c = conn.cursor()
    try:
        c.execute("""INSERT OR REPLACE INTO suspicious_users 
                     (user_id, linked_user_id, confidence_score, detected_at, status)
                     VALUES (?, ?, ?, ?, 'pending')""",
                  (user_id, linked_user_id, confidence, datetime.now()))
        conn.commit()
    finally:
        conn.close()

def get_suspicious_users(db_name: str = "tasks_bot.db") -> List[Tuple]:
    """Получить список подозрительных связей"""
    conn = sqlite3.connect(db_name)
    c = conn.cursor()
    c.execute("""SELECT user_id, linked_user_id, confidence_score, detected_at, status
                 FROM suspicious_users 
                 WHERE status = 'pending'
                 ORDER BY confidence_score DESC""")
    result = c.fetchall()
    conn.close()
    return result

def get_user_wallet(user_id: int, db_name: str = "tasks_bot.db") -> str:
    """Получить кошелек пользователя из заявок на вывод"""
    conn = sqlite3.connect(db_name)
    c = conn.cursor()
    c.execute("SELECT wallet_address FROM withdraw_requests WHERE user_id = ? ORDER BY request_id DESC LIMIT 1",
              (user_id,))
    result = c.fetchone()
    conn.close()
    return result[0] if result else None

def get_all_user_wallets(db_name: str = "tasks_bot.db") -> Dict[str, int]:
    """Получить все кошельки пользователей {wallet: user_id}"""
    conn = sqlite3.connect(db_name)
    c = conn.cursor()
    
    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='withdraw_requests'")
    if not c.fetchone():
        print("[ERROR] Таблица withdraw_requests не найдена")
        conn.close()
        return {}
    
    c.execute("""SELECT DISTINCT wallet_address, user_id 
                 FROM withdraw_requests 
                 WHERE wallet_address IS NOT NULL AND wallet_address != ''""")
    rows = c.fetchall()
    print(f"[DEBUG] Найдено кошельков в БД: {len(rows)}")
    
    result = {row[0]: row[1] for row in rows}
    conn.close()
    return result

def mark_suspicious_reviewed(user_id: int, linked_user_id: int, status: str,
                             db_name: str = "tasks_bot.db"):
    """Отметить связь как проверенную"""
    conn = sqlite3.connect(db_name)
    c = conn.cursor()
    c.execute("""UPDATE suspicious_users 
                 SET status = ? 
                 WHERE user_id = ? AND linked_user_id = ?""",
              (status, user_id, linked_user_id))
    conn.commit()
    conn.close()
