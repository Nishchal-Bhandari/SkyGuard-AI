from backend.app.storage.database import get_db

with get_db() as conn:
    cur = conn.cursor()
    cur.execute("SELECT * FROM training_jobs ORDER BY id DESC LIMIT 5")
    jobs = cur.fetchall()
    print('Training Jobs:')
    for j in jobs: print(j)
    
    cur.execute("SELECT * FROM model_registry ORDER BY id DESC LIMIT 5")
    models = cur.fetchall()
    print('\nModel Registry:')
    for m in models: print(m)
