"""Singer, song and film from a video's description, instead of the uploader's channel name."""

from services import credits

TAMANNA = """Song:- Yeh Aaine Jo Tumhein Kam Pasand Karte Hain
Singer(s):- Kumar Sanu,
Movie:- Tamanna ( 1997 )
Music Director:- Anu Malik
Soundtrack
# Song Singer(s) Lyrics
1 "Yeh Kya Hua" Kumar Sanu, Alka Yagnik Rahat Indori"""

BAAZIGAR = """Watch the 4K video of "Chhupana Bhi Nahi Aata", beautifully sung by Vinod Rathod.
🎵 Song: Chhupana Bhi Nahi Aata
🎥 Movie: Baazigar
🎤 Singer: Vinod Rathod
🎼 Music: Anu Malik
📅 Release Year: 1993"""


def test_reads_credit_lines():
    assert credits.parse_credits(TAMANNA) == {
        "singers": ["Kumar Sanu"], "song": "Yeh Aaine Jo Tumhein Kam Pasand Karte Hain", "album": "Tamanna", "year": "1997",
    }
    assert credits.parse_credits(BAAZIGAR) == {
        "singers": ["Vinod Rathod"], "song": "Chhupana Bhi Nahi Aata", "album": "Baazigar", "year": "1993",
    }


def test_several_singers_and_hashtags():
    assert credits.parse_credits("Singers : Kumar Sanu & Alka Yagnik")["singers"] == ["Kumar Sanu", "Alka Yagnik"]
    assert credits.parse_credits("Romantic song from Naaraaz film sung by #KumarSanu picturized on #SonaliBendre")["singers"] == ["Kumar Sanu"]


def test_no_credits_means_no_singer():
    assert credits.parse_credits("Like, share and subscribe! https://youtube.com/x")["singers"] == []


def test_uploader_is_used_only_for_an_artists_own_channel():
    assert credits.singer_for({"uploader": "khan79150", "description": ""}) == ""
    assert credits.singer_for({"uploader": "Kumar Sanu - Topic", "description": ""}) == "Kumar Sanu"
    assert credits.singer_for({"uploader": "ShreyaGhoshalVEVO", "description": ""}) == "Shreya Ghoshal"
    assert credits.singer_for({"uploader": "khan79150", "description": TAMANNA}) == "Kumar Sanu"
    # YouTube's own song details come first.
    assert credits.singer_for({"artists": ["Lata Mangeshkar"], "uploader": "x", "description": TAMANNA}) == "Lata Mangeshkar"
