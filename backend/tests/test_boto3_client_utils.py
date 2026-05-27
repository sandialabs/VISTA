from botocore.exceptions import ClientError

from utils.boto3_client import ensure_bucket_exists, sanitize_for_log


class StubClient:
    def __init__(self, head_error=None, create_error=None):
        self.head_error = head_error
        self.create_error = create_error
        self.created = False

    def head_bucket(self, Bucket):
        if self.head_error:
            raise self.head_error

    def create_bucket(self, Bucket):
        if self.create_error:
            raise self.create_error
        self.created = True


def _client_error(code: str, message: str = "err"):
    return ClientError({"Error": {"Code": code, "Message": message}}, "head_bucket")


def test_sanitize_for_log_strips_newlines():
    assert sanitize_for_log("hello\nworld\r\n!") == "helloworld!"


def test_ensure_bucket_exists_when_bucket_exists():
    client = StubClient()
    assert ensure_bucket_exists(client, "b") is True
    assert client.created is False


def test_ensure_bucket_exists_creates_on_404():
    client = StubClient(head_error=_client_error("404"))
    assert ensure_bucket_exists(client, "b") is True
    assert client.created is True


def test_ensure_bucket_exists_fails_on_non_404_or_create_error():
    forbidden = StubClient(head_error=_client_error("403"))
    assert ensure_bucket_exists(forbidden, "b") is False

    cannot_create = StubClient(head_error=_client_error("404"), create_error=_client_error("500"))
    assert ensure_bucket_exists(cannot_create, "b") is False


def test_ensure_bucket_exists_fails_without_client():
    assert ensure_bucket_exists(None, "b") is False
