from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('play/', views.play, name='play'),
    path('game/', views.game, name='game'),
    path('card/<int:index>/', views.card, name='card'),
    path('api/game_state', views.api_game_state, name='api_game_state'),
    path('api/select', views.api_select, name='api_select'),
    path('api/claim_bingo', views.api_claim_bingo, name='api_claim_bingo'),
    path('api/abandon', views.api_abandon, name='api_abandon'),
]
