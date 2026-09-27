"""
Модуль для работы с историей баланса пользователей
"""
import sqlite3
from datetime import datetime

def init_balance_history_db(db_name: str):
    """Инициализация таблицы истории баланса"""
    conn = sqlite3.connect(db_name)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS balance_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            operation_type TEXT NOT NULL,
            amount REAL NOT NULL,
            balance_type TEXT NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )
    """)
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_balance_history_user ON balance_history(user_id, created_at DESC)")
    
    conn.commit()
    conn.close()

def add_balance_record(db_name: str, user_id: int, operation_type: str, amount: float, 
                       balance_type: str, description: str = None):
    """
    Добавить запись в историю баланса
    
    operation_type: 'credit' (начисление) или 'debit' (списание)
    balance_type: 'tasks', 'bonus', 'rps', 'promo', 'referral', 'miner'
    """
    conn = sqlite3.connect(db_name)
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO balance_history (user_id, operation_type, amount, balance_type, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (user_id, operation_type, amount, balance_type, description, datetime.now().isoformat()))
    
    conn.commit()
    conn.close()

def get_user_balance_history(db_name: str, user_id: int, limit: int = 50):
    """Получить историю баланса пользователя"""
    conn = sqlite3.connect(db_name)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT operation_type, amount, balance_type, description, created_at
        FROM balance_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
    """, (user_id, limit))
    
    result = cursor.fetchall()
    conn.close()
    
    return result

def get_balance_stats(db_name: str, user_id: int):
    """Получить статистику по балансу пользователя"""
    conn = sqlite3.connect(db_name)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            SUM(CASE WHEN operation_type = 'credit' THEN amount ELSE 0 END) as total_earned,
            SUM(CASE WHEN operation_type = 'debit' THEN amount ELSE 0 END) as total_spent,
            COUNT(*) as total_operations
        FROM balance_history
        WHERE user_id = ?
    """, (user_id,))
    
    stats = cursor.fetchone()
    
    cursor.execute("""
        SELECT 
            balance_type,
            SUM(CASE WHEN operation_type = 'credit' THEN amount ELSE 0 END) as earned,
            SUM(CASE WHEN operation_type = 'debit' THEN amount ELSE 0 END) as spent
        FROM balance_history
        WHERE user_id = ?
        GROUP BY balance_type
    """, (user_id,))
    
    by_type = cursor.fetchall()
    conn.close()
    
    return {
        'total_earned': stats[0] or 0,
        'total_spent': stats[1] or 0,
        'total_operations': stats[2] or 0,
        'by_type': by_type
    }
