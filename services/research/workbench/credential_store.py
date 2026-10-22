"""Local-instance encryption. The separate private volume must accompany DB backups."""
import fcntl
import os
from cryptography.fernet import Fernet
from .config import settings


def cipher():
    root = settings().credential_store_path
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError('Credential directory must not be a symlink')
    fd = os.open(root / 'master.key', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        if os.fstat(fd).st_mode & 0o077:
            raise ValueError('Credential key file must be private')
        key = os.read(fd, 256)
        if not key:
            key = Fernet.generate_key()
            os.write(fd, key)
            os.fsync(fd)
        return Fernet(key)
    finally:
        os.close(fd)


def encrypt(secret):
    return cipher().encrypt(secret.encode()).decode()


def decrypt(ciphertext):
    try:
        return cipher().decrypt(ciphertext.encode()).decode()
    except Exception:
        raise ValueError('Local credential storage unavailable; reconnect the provider') from None
