from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()


class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    display_name = db.Column(db.String(64), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    uploads = db.relationship('Upload', backref='user', lazy=True)
    spends = db.relationship('DailySpend', backref='user', lazy=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Advertiser(db.Model):
    __tablename__ = 'advertisers'
    id = db.Column(db.Integer, primary_key=True)
    advertiser_id = db.Column(db.String(128), unique=True, nullable=False)
    account_id = db.Column(db.String(64))
    name = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    spends = db.relationship('DailySpend', backref='advertiser', lazy=True)


class Upload(db.Model):
    __tablename__ = 'uploads'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    filename = db.Column(db.String(256), nullable=False)
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)
    records_count = db.Column(db.Integer, default=0)

    spends = db.relationship('DailySpend', backref='upload', lazy=True)


class DailySpend(db.Model):
    __tablename__ = 'daily_spend'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    advertiser_id = db.Column(db.String(128), db.ForeignKey('advertisers.advertiser_id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    media = db.Column(db.String(32), nullable=False)
    amount = db.Column(db.BigInteger, default=0)
    upload_id = db.Column(db.Integer, db.ForeignKey('uploads.id'))

    __table_args__ = (
        db.UniqueConstraint('user_id', 'advertiser_id', 'date', 'media', name='uq_spend'),
    )
