from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class Trade(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, index=True)
    session = db.Column(db.String(20), default="New York")
    coin = db.Column(db.String(20))
    direction = db.Column(db.String(20), default="long")
    setup = db.Column(db.String(20), default="Breakout")
    sl = db.Column(db.Float, nullable=True)
    tp = db.Column(db.Float, nullable=True)
    rr = db.Column(db.Float, nullable=True)
    pnl = db.Column(db.Float, nullable=True)
    rules_followed = db.Column(db.Boolean, nullable=True)
    reason = db.Column(db.Text, default="")
    confluences = db.Column(db.JSON, default=list)   # ["confDailyOB", "confBOS", ...]
    thesis = db.Column(db.Text, default="")
    what_happened = db.Column(db.Text, default="")
    better = db.Column(db.Text, default="")
    lesson = db.Column(db.String(140), default="")
    entry_type = db.Column(db.String(10), default="live")  # "live" | "backtest"
    notes = db.Column(db.Text, default="")  # day-level note, not tied to a specific trade
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    updated_at = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())

    def to_dict(self):
        d = {c.name: getattr(self, c.name) for c in self.__table__.columns}
        if self.date:
            d["date"] = self.date.isoformat()
        if self.created_at:
            d["created_at"] = self.created_at.isoformat()
        if self.updated_at:
            d["updated_at"] = self.updated_at.isoformat()
        return d

class MonthlySummary(db.Model):
    """For backfilling old months without re-entering every trade."""
    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False)
    month = db.Column(db.Integer, nullable=False)  # 1-12
    pnl = db.Column(db.Float, nullable=False)
    __table_args__ = (db.UniqueConstraint('year', 'month'),)

class ContractLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    day_key = db.Column(db.String(10), unique=True)  # "2026-09-05"
    signed_by = db.Column(db.String(50))
    signed_at = db.Column(db.DateTime)
    followed = db.Column(db.Boolean, nullable=True)