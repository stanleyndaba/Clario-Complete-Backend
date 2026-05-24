import os
from dotenv import load_dotenv
from sp_api.api import Sellers
from sp_api.base import Marketplaces, SellingApiBadRequestException, SellingApiForbiddenException, SellingApiServerException

# Load env variables from the Integrations-backend directory
load_dotenv('Integrations-backend/.env')

LWA_APP_ID = os.environ.get('AMAZON_CLIENT_ID')
LWA_CLIENT_SECRET = os.environ.get('AMAZON_CLIENT_SECRET')
AWS_ACCESS_KEY = os.environ.get('AWS_ACCESS_KEY_ID')
AWS_SECRET_KEY = os.environ.get('AWS_SECRET_ACCESS_KEY')
AWS_ROLE_ARN = os.environ.get('AWS_ROLE_ARN') 
REFRESH_TOKEN = os.environ.get('AMAZON_SPAPI_REFRESH_TOKEN')

def make_keep_alive_call():
    print("Attempting to make a 'keep-alive' SP-API call...")
    try:
        api = Sellers(
            marketplace=Marketplaces.US,
            credentials=dict(
                refresh_token=REFRESH_TOKEN,
                lwa_app_id=LWA_APP_ID,
                lwa_client_secret=LWA_CLIENT_SECRET,
                aws_access_key=AWS_ACCESS_KEY,
                aws_secret_key=AWS_SECRET_KEY,
                aws_role_arn=AWS_ROLE_ARN
            )
        )

        response = api.get_marketplace_participation()

        print("API Call Successful!")
        print("Response:", str(response)[:500])
        print("Your Amazon SP-API access should now be safe for another 90 days.")

    except SellingApiBadRequestException as e:
        print(f"API Error (Bad Request): {e}")
    except SellingApiForbiddenException as e:
        print(f"API Error (Forbidden): {e}")
    except SellingApiServerException as e:
        print(f"API Error (Amazon Server Issue): {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

if __name__ == '__main__':
    make_keep_alive_call()
